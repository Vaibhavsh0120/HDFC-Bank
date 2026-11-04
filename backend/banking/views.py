from django.conf import settings
from hashlib import sha256
from django.contrib.auth import authenticate
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import IntegrityError, connection, transaction
from django.db.models import Q
from django.http import JsonResponse
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from google.auth import exceptions as google_exceptions
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2 import id_token

from .authentication import issue_token
from .models import Account, Entry, GoogleIdentity
from .serializers import GoogleCredentialSerializer, InstructionSerializer, LoginSerializer, PinChangeSerializer, PinSerializer, RegistrationSerializer, User, account_data, entry_data
from .pin import pin_status, set_pin, verify_pin
from .services import BankingError, Instruction, account_id, mini_statement, post_entry, recipient_for


class AccessThrottle(ScopedRateThrottle):
    def allow_request(self, request, view):
        setattr(view, "throttle_scope", "access")
        return super().allow_request(request, view)


class RecipientThrottle(ScopedRateThrottle):
    def allow_request(self, request, view):
        setattr(view, "throttle_scope", "recipient")
        return super().allow_request(request, view)


def session_response(user, status=200):
    response = Response({"token": issue_token(user), "account": account_data(user.account)}, status=status)
    response["Cache-Control"] = "no-store"
    return response


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([AccessThrottle])
def register(request):
    serializer = RegistrationSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    with transaction.atomic():
        try:
            with transaction.atomic():
                user = User.objects.create_user(
                    username=data["email"], email=data["email"],
                    password=data["password"], first_name=data["name"],
                )
        except IntegrityError:
            if User.objects.filter(username=data["email"]).exists():
                return Response({"detail": "An account already uses this email address."}, status=409)
            raise
        Account.objects.create(owner=user)
        return session_response(user, 201)


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([AccessThrottle])
def login(request):
    serializer = LoginSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    user = authenticate(request, username=data["email"].lower(), password=data["password"])
    if user is None:
        return Response({"detail": "Check your email address and password."}, status=401)
    with transaction.atomic():
        current = User.objects.select_for_update().filter(pk=user.pk, is_active=True).first()
        # Password recovery/change uses the same user lock. An authentication
        # snapshot taken before it must not mint a new session afterwards.
        if (current is None or current.password != user.password
                or current.username != data["email"].lower()
                or not Account.objects.filter(owner=current).exists()):
            return Response({"detail": "Check your email address and password."}, status=401)
        return session_response(current)


@api_view(["GET"])
@permission_classes([AllowAny])
def google_config(request):
    return Response({"client_id": settings.GOOGLE_CLIENT_ID})


def verified_google(data):
    serializer = GoogleCredentialSerializer(data=data)
    serializer.is_valid(raise_exception=True)
    if not settings.GOOGLE_CLIENT_ID:
        return None, Response({"detail": "Google sign-in is not configured."}, status=503)
    try:
        claims = id_token.verify_oauth2_token(
            serializer.validated_data["credential"], GoogleRequest(), settings.GOOGLE_CLIENT_ID,
        )
    except google_exceptions.TransportError:
        return None, Response({"detail": "Google sign-in is temporarily unavailable. Try again."}, status=503)
    except (ValueError, google_exceptions.GoogleAuthError):
        return None, Response({"detail": "Google sign-in could not be verified."}, status=401)

    subject = claims.get("sub")
    email = claims.get("email")
    if (claims.get("iss") not in ("accounts.google.com", "https://accounts.google.com")
            or claims.get("email_verified") is not True
            or not isinstance(subject, str) or not subject or len(subject) > 255 or not subject.isascii()
            or not isinstance(email, str) or len(email) > 150):
        return None, Response({"detail": "Google did not provide a verified account."}, status=401)
    email = email.lower()
    try:
        validate_email(email)
    except ValidationError:
        return None, Response({"detail": "Google did not provide a valid email address."}, status=401)
    return {**claims, "email": email, "subject_hash": sha256(subject.encode("ascii")).hexdigest()}, None


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([AccessThrottle])
def google_login(request):
    claims, error = verified_google(request.data)
    if error is not None:
        return error
    subject_hash, email = claims['subject_hash'], claims['email']
    identity = GoogleIdentity.objects.select_related("user").filter(subject_hash=subject_hash).first()
    if identity is None:
        try:
            with transaction.atomic():
                # Email-password accounts are not automatically linked. Registration
                # does not verify email ownership, so linking by email allows takeover.
                if User.objects.filter(username=email).exists():
                    return Response({"detail": "An account already uses this email. Sign in with its password."}, status=409)
                name = claims.get("name")
                name = name.strip()[:150] if isinstance(name, str) else ""
                user = User.objects.create_user(username=email, email=email, first_name=name or email)
                Account.objects.create(owner=user)
                identity = GoogleIdentity.objects.create(subject_hash=subject_hash, user=user)
        except IntegrityError:
            identity = GoogleIdentity.objects.select_related("user").filter(subject_hash=subject_hash).first()
            if identity is None:
                return Response({"detail": "An account already uses this email. Sign in with its password."}, status=409)
    with transaction.atomic():
        user = User.objects.select_for_update().get(pk=identity.user_id)
        # Unlink/password changes hold this lock too. Never mint a session
        # from a Google identity that was removed while verification ran.
        if not user.is_active or not Account.objects.filter(owner=user).exists():
            return Response({"detail": "This account is unavailable."}, status=403)
        if not GoogleIdentity.objects.filter(user=user, subject_hash=subject_hash).exists():
            return Response({"detail": "Google sign-in was unlinked. Sign in with your password."}, status=401)
        return session_response(user)


@api_view(["POST"])
def logout(request):
    request.auth.delete()
    return Response(status=204)


def own_account(request):
    return Account.objects.select_related("owner").get(owner=request.user)


@api_view(["GET", "POST", "PATCH"])
def transaction_pin(request):
    account = own_account(request)
    if request.method == "POST":
        serializer = PinSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if not set_pin(account.pk, serializer.validated_data["pin"]):
            return Response({"detail": "A transaction PIN is already set."}, status=409)
        account.refresh_from_db()
    elif request.method == "PATCH":
        serializer = PinChangeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = verify_pin(
            account.pk, serializer.validated_data["current_pin"],
            new_pin=serializer.validated_data["new_pin"],
        )
        if result == "not_configured":
            return Response({"detail": "Set a transaction PIN before continuing."}, status=403)
        if result == "locked":
            return Response({"detail": "Too many incorrect PIN attempts. Try again in 15 minutes."}, status=429)
        if result != "ok":
            return Response({"detail": "Incorrect transaction PIN."}, status=400)
        account.refresh_from_db()
    return Response(pin_status(account))


@api_view(["GET"])
def dashboard(request):
    account = own_account(request)
    return Response({
        "account": account_data(account),
        "recent": [entry_data(entry, account.pk) for entry in mini_statement(account)],
    })


@api_view(["POST"])
@throttle_classes([RecipientThrottle])
def recipient(request):
    try:
        target = recipient_for(own_account(request).pk, str(request.data.get("number", "")))
    except BankingError as exc:
        return Response({"detail": str(exc)}, status=exc.status)
    return Response({"name": target.owner.first_name, "number": target.number})


@api_view(["POST"])
def movement(request):
    serializer = InstructionSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data.copy()
    number = data.pop("recipient", None)
    pin = data.pop("pin", None)
    source = own_account(request)
    try:
        target_id = account_id(number) if number else None
        instruction = Instruction(**data, recipient_id=target_id)
        entry, created = post_entry(source.pk, instruction, pin=pin)
    except BankingError as exc:
        return Response({"detail": str(exc)}, status=exc.status)
    source.refresh_from_db(fields=["balance", "status"])
    return Response(
        {"entry": entry_data(entry, source.pk), "account": account_data(source)},
        status=201 if created else 200,
    )


@api_view(["GET"])
def history(request):
    account = own_account(request)
    entries = Entry.objects.filter(Q(initiator=account) | Q(recipient=account)).select_related(
        "initiator__owner", "recipient__owner",
    )
    kind = request.query_params.get("kind", "")
    if kind:
        if kind not in Entry.Kind.values:
            return Response({"detail": "Unknown transaction type."}, status=400)
        entries = entries.filter(kind=kind)
    query = request.query_params.get("q", "").strip()[:140]
    if query:
        search = (
            Q(description__icontains=query) | Q(reference__icontains=query.replace("-", ""))
            | Q(initiator__owner__first_name__icontains=query, recipient=account)
            | Q(recipient__owner__first_name__icontains=query, initiator=account)
        )
        try:
            counterparty = account_id(query)
        except BankingError:
            pass
        else:
            search |= Q(initiator_id=counterparty, recipient=account) | Q(recipient_id=counterparty, initiator=account)
        entries = entries.filter(search)
    paginator = PageNumberPagination()
    paginator.page_size = 15
    rows = paginator.paginate_queryset(entries, request)
    if rows is None:
        raise RuntimeError("History pagination is not configured.")
    return paginator.get_paginated_response([entry_data(entry, account.pk) for entry in rows])


def health(request):
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1")
    return JsonResponse({"status": "ok", "api_version": 2})
