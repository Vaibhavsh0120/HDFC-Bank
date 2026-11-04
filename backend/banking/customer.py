"""Customer services. Every record is scoped to the authenticated account."""
import logging
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.mail import send_mail
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from .models import Account, AccessSession, Beneficiary, EmailChallenge, Nominee, SupportRequest, VirtualCard
from .pin import verify_pin
from .serializers import account_data
from .services import BankingError, recipient_for
from .views import own_account


class SecurityThrottle(ScopedRateThrottle):
    def allow_request(self, request, view):
        if request.method in ('GET', 'HEAD', 'OPTIONS'):
            return True
        view.throttle_scope = 'security'
        return super().allow_request(request, view)


class RecoveryThrottle(ScopedRateThrottle):
    def allow_request(self, request, view):
        view.throttle_scope = 'recovery'
        return super().allow_request(request, view)


def require_pin(account, data):
    pin = serializers.RegexField(r'^[0-9]{4,6}$', write_only=True).run_validation(data.get('pin'))
    result = verify_pin(account.pk, pin)
    if result != 'ok':
        text = {'locked': 'PIN is locked. Try again in 15 minutes.', 'not_configured': 'Set a transaction PIN first.'}
        return Response({'detail': text.get(result, 'Incorrect transaction PIN.')}, status=429 if result == 'locked' else 403)
    return None


def password_error(password, user):
    try:
        validate_password(password, user)
    except ValidationError as exc:
        return Response({'password': exc.messages}, status=400)
    return None


class ProfileSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=150, required=False)
    email = serializers.EmailField(max_length=150, required=False)
    phone = serializers.RegexField(r'^\+?[1-9][0-9]{6,14}$', max_length=16, required=False, allow_blank=True)
    address = serializers.CharField(max_length=300, required=False, allow_blank=True)
    current_password = serializers.CharField(required=False, trim_whitespace=False, max_length=128, write_only=True)
    payment_locked = serializers.BooleanField(required=False)
    transfer_alerts = serializers.BooleanField(required=False)
    pin = serializers.CharField(required=False, write_only=True)


@api_view(['GET', 'PATCH'])
@throttle_classes([SecurityThrottle])
def profile(request):
    account = own_account(request)
    if request.method == 'PATCH':
        values = ProfileSerializer(data=request.data)
        values.is_valid(raise_exception=True)
        data = values.validated_data
        email = data.get('email', account.owner.email).lower()
        changed_email = email != account.owner.email
        if changed_email and not account.owner.check_password(data.get('current_password', '')):
            return Response({'detail': 'Enter your current password to change your email. Google-only accounts can create a password with Forgot password.'}, status=400)
        try:
            with transaction.atomic():
                user = User.objects.select_for_update().get(pk=request.user.pk)
                # A stale password/email snapshot must not overwrite concurrent security changes.
                if changed_email and (user.email != account.owner.email or not user.check_password(data.get('current_password', ''))):
                    return Response({'detail': 'Your account changed. Reload and try again.'}, status=409)
                if changed_email and User.objects.exclude(pk=user.pk).filter(username=email).exists():
                    return Response({'detail': 'This email address is already in use.'}, status=409)
                account = Account.objects.select_for_update().get(pk=account.pk)
                # Compare with the locked row, not the earlier response snapshot.
                # Returning an error commits failed PIN attempts without editing the profile.
                if 'payment_locked' in data and data['payment_locked'] != account.payment_locked:
                    if error := require_pin(account, request.data):
                        return error
                user.first_name = data.get('name', user.first_name)
                if changed_email:
                    user.username = user.email = email
                    EmailChallenge.objects.filter(user=user).delete()
                user.save(update_fields=['first_name', 'username', 'email'])
                fields = [key for key in ('phone', 'address', 'payment_locked', 'transfer_alerts') if key in data]
                for key in fields:
                    setattr(account, key, data[key])
                if fields:
                    account.save(update_fields=fields)
        except IntegrityError:
            return Response({'detail': 'This email address is already in use.'}, status=409)
        account = own_account(request)
    return Response(account_data(account))


def email_ready():
    if settings.DEBUG:
        return True
    if settings.EMAIL_BACKEND == 'banking.email_backend.ResendEmailBackend':
        return bool(settings.RESEND_API_KEY)
    return settings.EMAIL_BACKEND == 'django.core.mail.backends.smtp.EmailBackend' and bool(settings.EMAIL_HOST)


def send_code(user, purpose):
    """Serialize issuing with consuming codes; never return a code in an API response."""
    if not email_ready():
        return Response({'detail': 'Email recovery is not configured. Please contact the project maintainer.'}, status=503)
    with transaction.atomic():
        user = User.objects.select_for_update().get(pk=user.pk)
        recent = EmailChallenge.objects.filter(user=user, purpose=purpose).order_by('-pk').first()
        if recent and recent.created_at > timezone.now() - timedelta(seconds=60):
            return None
        code = f'{secrets.randbelow(1000000):06d}'
        challenge = EmailChallenge.objects.create(
            user=user, purpose=purpose, email=user.email, code_hash=make_password(code),
            expires_at=timezone.now() + timedelta(minutes=10),
        )
        try:
            sent = send_mail(
                'Reset your ' + ('transaction PIN' if purpose == 'pin_reset' else 'password'),
                f'Your HDFC Bank student project code is {code}.\n\n'
                'It expires in 10 minutes. Never share it. If you did not request this, ignore this email.\n'
                'Enter this code in the app or website where you requested the reset.',
                settings.DEFAULT_FROM_EMAIL, [user.email], fail_silently=False,
            )
            if sent != 1:
                raise RuntimeError('Email backend did not accept the recovery message.')
        except Exception:
            logging.getLogger(__name__).exception('Recovery email delivery failed')
            challenge.delete()
            return Response({'detail': 'Email could not be sent. Try again later or contact the project maintainer.'}, status=503)
        EmailChallenge.objects.filter(user=user, purpose=purpose).exclude(pk=challenge.pk).delete()
    return None


def check_code(user, purpose, code):
    """Caller holds user lock. Return an error string, persisting failed attempts."""
    challenge = EmailChallenge.objects.select_for_update().filter(user=user, purpose=purpose).order_by('-pk').first()
    if (not challenge or challenge.email != user.email or challenge.expires_at <= timezone.now()
            or challenge.failures >= 5):
        return 'Code is invalid or expired. Request a new code.'
    if not check_password(code, challenge.code_hash):
        challenge.failures += 1
        challenge.save(update_fields=['failures'])
        return 'Code is invalid or expired. Request a new code if needed.'
    challenge.delete()
    return None


class ResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=150)


class PasswordResetSerializer(ResetRequestSerializer):
    code = serializers.RegexField(r'^[0-9]{6}$', write_only=True)
    password = serializers.CharField(max_length=128, trim_whitespace=False, write_only=True)


@api_view(['POST'])
@permission_classes([AllowAny])
@throttle_classes([RecoveryThrottle])
def password_reset_request(request):
    serializer = ResetRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    if not email_ready():
        return Response({'detail': 'Email recovery is not configured. Please contact the project maintainer.'}, status=503)
    user = User.objects.filter(username=serializer.validated_data['email'].lower(), is_active=True, account__isnull=False).first()
    if user:
        error = send_code(user, 'password_reset')
        if error is not None:
            # Do not expose whether the address has an account when delivery fails.
            logging.getLogger(__name__).warning('Password recovery delivery unavailable')
    return Response({'detail': 'If an account uses this email, a reset code has been sent. Check your inbox and spam folder.'})


@api_view(['POST'])
@permission_classes([AllowAny])
@throttle_classes([SecurityThrottle])
def password_reset_confirm(request):
    serializer = PasswordResetSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    with transaction.atomic():
        user = User.objects.select_for_update().filter(username=data['email'].lower(), is_active=True, account__isnull=False).first()
        if not user:
            return Response({'detail': 'Code is invalid or expired. Request a new code.'}, status=400)
        if error := password_error(data['password'], user):
            return error
        if error := check_code(user, 'password_reset', data['code']):
            return Response({'detail': error}, status=400)
        user.set_password(data['password'])
        user.save(update_fields=['password'])
        # A recovered password must not leave a potentially stolen login usable.
        AccessSession.objects.filter(user=user).delete()
    return Response({'detail': 'Password reset. Sign in with your new password.'})


@api_view(['POST'])
@throttle_classes([SecurityThrottle])
def password_change(request):
    class ChangeSerializer(serializers.Serializer):
        current_password = serializers.CharField(max_length=128, trim_whitespace=False, write_only=True)
        new_password = serializers.CharField(max_length=128, trim_whitespace=False, write_only=True)
    serializer = ChangeSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    with transaction.atomic():
        user = User.objects.select_for_update().get(pk=request.user.pk)
        if not user.check_password(data['current_password']):
            return Response({'detail': 'Current password is incorrect.'}, status=400)
        if error := password_error(data['new_password'], user):
            return error
        if user.check_password(data['new_password']):
            return Response({'detail': 'Choose a password different from the current password.'}, status=400)
        user.set_password(data['new_password'])
        user.save(update_fields=['password'])
    return Response({'detail': 'Password changed.'})


@api_view(['POST'])
@throttle_classes([RecoveryThrottle])
def pin_reset_request(request):
    error = send_code(request.user, 'pin_reset')
    return error if error is not None else Response({'detail': 'A PIN reset code was sent to your registered email.'})


@api_view(['POST'])
@throttle_classes([SecurityThrottle])
def pin_reset_confirm(request):
    class PinResetSerializer(serializers.Serializer):
        code = serializers.RegexField(r'^[0-9]{6}$', write_only=True)
        pin = serializers.RegexField(r'^[0-9]{4,6}$', write_only=True)
    serializer = PinResetSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    with transaction.atomic():
        user = User.objects.select_for_update().get(pk=request.user.pk)
        if error := check_code(user, 'pin_reset', serializer.validated_data['code']):
            return Response({'detail': error}, status=400)
        account = Account.objects.select_for_update().get(owner=user)
        account.pin_hash = make_password(serializer.validated_data['pin'])
        account.pin_failures = 0
        account.pin_locked_until = None
        account.save(update_fields=['pin_hash', 'pin_failures', 'pin_locked_until'])
    return Response({'configured': True, 'locked_until': None})


class NomineeSerializer(serializers.ModelSerializer):
    class Meta:
        model = Nominee
        fields = ['name', 'relationship', 'date_of_birth', 'address', 'guardian_name', 'guardian_relationship', 'guardian_address']

    def validate(self, attrs):
        born = attrs['date_of_birth']
        today = timezone.localdate()
        if born > today or born.year < today.year - 120:
            raise serializers.ValidationError({'date_of_birth': 'Enter a valid date of birth.'})
        age = today.year - born.year - ((today.month, today.day) < (born.month, born.day))
        if age < 18 and any(not attrs.get(key, '').strip() for key in ('guardian_name', 'guardian_relationship', 'guardian_address')):
            raise serializers.ValidationError('A nominee under 18 needs guardian name, relationship and address.')
        if age >= 18:
            for key in ('guardian_name', 'guardian_relationship', 'guardian_address'):
                attrs[key] = ''
        return attrs


@api_view(['GET', 'POST', 'DELETE'])
@throttle_classes([SecurityThrottle])
def nominee(request):
    account = own_account(request)
    row = Nominee.objects.filter(account=account).first()
    if request.method != 'GET':
        if error := require_pin(account, request.data):
            return error
        if request.method == 'DELETE':
            Nominee.objects.filter(account=account).delete()
            return Response(status=204)
        serializer = NomineeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        row, _ = Nominee.objects.update_or_create(account=account, defaults=serializer.validated_data)
    return Response({'nominee': NomineeSerializer(row).data if row else None})


@api_view(['GET', 'POST', 'DELETE'])
@throttle_classes([SecurityThrottle])
def beneficiaries(request):
    account = own_account(request)
    if request.method != 'GET':
        number = serializers.RegexField(r'^9[01][0-9]{10}$').run_validation(request.data.get('number'))
        if request.method == 'DELETE':
            Beneficiary.objects.filter(account=account, recipient__account_number=number).delete()
        else:
            try:
                target = recipient_for(account.pk, number)
            except BankingError as exc:
                return Response({'detail': str(exc)}, status=exc.status)
            nickname = serializers.CharField(max_length=80, allow_blank=True).run_validation(request.data.get('nickname', ''))
            Beneficiary.objects.update_or_create(account=account, recipient=target, defaults={'nickname': nickname})
    rows = Beneficiary.objects.filter(account=account).select_related('recipient__owner').order_by('nickname', 'pk')
    return Response({'beneficiaries': [{'number': row.recipient.number, 'name': row.recipient.owner.first_name, 'nickname': row.nickname} for row in rows]})


def card_data(card):
    today = timezone.localdate(card.created_at)
    return {'identifier': str(card.identifier), 'last_four': card.identifier.hex[-4:].upper(),
            'frozen': card.frozen, 'expires': f'{today.month:02d}/{(today.year + 3) % 100:02d}', 'created_at': card.created_at.isoformat()}


@api_view(['GET', 'POST', 'PATCH'])
@throttle_classes([SecurityThrottle])
def virtual_card(request):
    account = own_account(request)
    card = VirtualCard.objects.filter(account=account).first()
    if request.method != 'GET':
        if account.status != Account.Status.ACTIVE:
            return Response({'detail': 'Card changes are unavailable while the account is frozen.'}, status=403)
        if error := require_pin(account, request.data):
            return error
        if request.method == 'POST':
            card, _ = VirtualCard.objects.get_or_create(account=account)
        else:
            if not card:
                return Response({'detail': 'Create your virtual card first.'}, status=404)
            card.frozen = serializers.BooleanField().run_validation(request.data.get('frozen'))
            card.save(update_fields=['frozen'])
    return Response({'card': card_data(card) if card else None})


@api_view(['GET', 'POST'])
@throttle_classes([SecurityThrottle])
def support(request):
    account = own_account(request)
    if request.method == 'POST':
        class SupportSerializer(serializers.Serializer):
            category = serializers.ChoiceField(choices=['Payment', 'Account', 'Card', 'Other'])
            message = serializers.CharField(min_length=10, max_length=2000)
        serializer = SupportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        SupportRequest.objects.create(account=account, **serializer.validated_data)
    rows = SupportRequest.objects.filter(account=account).order_by('-pk')[:30]
    return Response({'requests': [{'reference': str(row.reference), 'category': row.category, 'message': row.message, 'status': row.status, 'response': row.response, 'created_at': row.created_at.isoformat()} for row in rows]})
