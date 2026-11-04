import re
from datetime import timedelta
from unittest.mock import patch

from django.core import mail
from django.core.cache import cache
from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.models import User
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from .authentication import issue_token
from .models import Account, AccessSession, Beneficiary, EmailChallenge, Nominee, SupportRequest, VirtualCard


@override_settings(DEBUG=True)
class CustomerFlowTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.password = 'Ocean!Bright427'
        self.user = User.objects.create_user(username='alice@example.test', email='alice@example.test', first_name='Alice Rao', password=self.password)
        self.account = Account.objects.create(owner=self.user, balance='1000.00', pin_hash=make_password('1234'))
        self.other = User.objects.create_user(username='bob@example.test', email='bob@example.test', first_name='Bob Patel', password=self.password)
        self.other_account = Account.objects.create(owner=self.other)
        self.token = issue_token(self.user)
        self.client.credentials(HTTP_AUTHORIZATION='Bearer ' + self.token)

    def code(self):
        return re.search(r'code is ([0-9]{6})', mail.outbox[-1].body).group(1)

    def test_profile_edit_contact_validation_and_duplicate_email(self):
        result = self.client.patch('/api/profile/', {'name': 'Alice Updated', 'phone': '+919876543210', 'address': 'New Delhi'})
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(result.data['phone'], '+919876543210')
        self.assertEqual(result.data['name'], 'Alice Updated')
        self.assertNotIn('pin_hash', result.data)
        self.assertEqual(self.client.patch('/api/profile/', {'phone': '123'}).status_code, 400)
        self.assertEqual(self.client.patch('/api/profile/', {'email': 'new@example.test'}).status_code, 400)
        self.assertEqual(self.client.patch('/api/profile/', {'email': self.other.email, 'current_password': self.password}).status_code, 409)
        self.other.refresh_from_db()
        self.assertEqual(self.other.first_name, 'Bob Patel')

    def test_email_change_updates_login_and_cancels_old_recovery_codes(self):
        self.client.post('/api/auth/password/reset/request/', {'email': self.user.email})
        result = self.client.patch('/api/profile/', {'email': 'NEW@example.test', 'current_password': self.password})
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(result.data['email'], 'new@example.test')
        self.assertFalse(EmailChallenge.objects.filter(user=self.user).exists())
        self.client.credentials()
        self.assertEqual(self.client.post('/api/auth/login/', {'email': 'new@example.test', 'password': self.password}).status_code, 200)
        self.assertEqual(self.client.post('/api/auth/login/', {'email': 'alice@example.test', 'password': self.password}).status_code, 401)

    def test_payment_lock_is_server_enforced_but_receipts_can_be_replayed(self):
        from uuid import uuid4
        body = {'kind': 'withdraw', 'amount': '5', 'pin': '1234', 'request_id': str(uuid4())}
        first = self.client.post('/api/movements/', body)
        self.assertEqual(first.status_code, 201)
        self.assertEqual(self.client.patch('/api/profile/', {'payment_locked': True, 'pin': '9999'}).status_code, 403)
        result = self.client.patch('/api/profile/', {'payment_locked': True, 'pin': '1234'})
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(self.client.post('/api/movements/', {**body, 'request_id': str(uuid4())}).status_code, 400)
        self.assertEqual(self.client.post('/api/movements/', body).status_code, 200)
        self.assertEqual(self.client.patch('/api/profile/', {'payment_locked': False, 'pin': '1234'}).status_code, 200)
        self.assertEqual(self.client.post('/api/movements/', {**body, 'request_id': str(uuid4())}).status_code, 201)

    def test_preferences_do_not_require_pin_without_lock_change(self):
        result = self.client.patch('/api/profile/', {'transfer_alerts': False})
        self.assertEqual(result.status_code, 200)
        self.assertFalse(result.data['transfer_alerts'])

    def test_concurrent_payment_lock_change_cannot_bypass_pin(self):
        from .views import own_account

        def stale_account(request):
            snapshot = own_account(request)
            Account.objects.filter(pk=snapshot.pk).update(payment_locked=True)
            return snapshot

        # Another request locks payments after this request reads its snapshot.
        with patch('banking.customer.own_account', side_effect=stale_account):
            result = self.client.patch('/api/profile/', {'payment_locked': False})
        self.assertEqual(result.status_code, 400)
        self.account.refresh_from_db()
        self.assertTrue(self.account.payment_locked)

    def test_rejected_payment_lock_change_preserves_pin_failures(self):
        Account.objects.filter(pk=self.account.pk).update(payment_locked=True)
        result = self.client.patch('/api/profile/', {'payment_locked': False, 'pin': '9999'})
        self.assertEqual(result.status_code, 403)
        self.account.refresh_from_db()
        self.assertTrue(self.account.payment_locked)
        self.assertEqual(self.account.pin_failures, 1)

    def test_password_reset_email_code_single_use_and_session_cleanup(self):
        self.client.credentials()
        self.assertEqual(self.client.post('/api/auth/password/reset/request/', {'email': self.user.email}).status_code, 200)
        self.assertEqual(mail.outbox[-1].to, [self.user.email])
        code = self.code()
        challenge = EmailChallenge.objects.get(user=self.user)
        self.assertNotEqual(challenge.code_hash, code)
        self.assertTrue(check_password(code, challenge.code_hash))
        body = {'email': self.user.email, 'code': code, 'password': 'New!OceanBright28'}
        self.assertEqual(self.client.post('/api/auth/password/reset/confirm/', body).status_code, 200)
        self.assertEqual(self.client.post('/api/auth/password/reset/confirm/', body).status_code, 400)
        self.assertFalse(AccessSession.objects.filter(user=self.user).exists())
        self.assertEqual(self.client.post('/api/auth/login/', {'email': self.user.email, 'password': body['password']}).status_code, 200)

    def test_reset_does_not_enumerate_accounts_or_return_codes(self):
        self.client.credentials()
        known = self.client.post('/api/auth/password/reset/request/', {'email': self.user.email})
        unknown = self.client.post('/api/auth/password/reset/request/', {'email': 'nobody@example.test'})
        self.assertEqual(known.data, unknown.data)
        self.assertEqual(len(mail.outbox), 1)
        self.assertNotIn(self.code(), str(known.data))

    def test_wrong_recovery_codes_lock_and_expired_codes_fail(self):
        self.client.post('/api/auth/password/reset/request/', {'email': self.user.email})
        code = self.code()
        body = {'email': self.user.email, 'code': '999999' if code != '999999' else '000000', 'password': 'New!OceanBright28'}
        for _ in range(5):
            self.assertEqual(self.client.post('/api/auth/password/reset/confirm/', body).status_code, 400)
        self.assertEqual(EmailChallenge.objects.get(user=self.user).failures, 5)
        self.assertEqual(self.client.post('/api/auth/password/reset/confirm/', {**body, 'code': code}).status_code, 400)
        EmailChallenge.objects.update(failures=0, expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.client.post('/api/auth/password/reset/confirm/', {**body, 'code': code}).status_code, 400)

    def test_weak_password_does_not_consume_reset_code(self):
        self.client.post('/api/auth/password/reset/request/', {'email': self.user.email})
        body = {'email': self.user.email, 'code': self.code(), 'password': '123'}
        self.assertEqual(self.client.post('/api/auth/password/reset/confirm/', body).status_code, 400)
        self.assertTrue(EmailChallenge.objects.filter(user=self.user).exists())

    def test_resend_cooldown_and_cross_purpose_recovery(self):
        self.client.post('/api/auth/password/reset/request/', {'email': self.user.email})
        password_code = self.code()
        self.client.post('/api/auth/password/reset/request/', {'email': self.user.email})
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(self.client.post('/api/security/pin/reset/confirm/', {'code': password_code, 'pin': '6789'}).status_code, 400)
        self.client.post('/api/security/pin/reset/request/')
        pin_code = self.code()
        self.assertEqual(self.client.post('/api/security/pin/reset/confirm/', {'code': pin_code, 'pin': '6789'}).status_code, 200)
        self.account.refresh_from_db()
        self.assertTrue(check_password('6789', self.account.pin_hash))

    def test_pin_reset_unlocks_failed_attempts(self):
        Account.objects.filter(pk=self.account.pk).update(pin_failures=5, pin_locked_until=timezone.now() + timedelta(minutes=15))
        self.client.post('/api/security/pin/reset/request/')
        self.assertEqual(self.client.post('/api/security/pin/reset/confirm/', {'code': self.code(), 'pin': '6789'}).status_code, 200)
        self.account.refresh_from_db()
        self.assertEqual(self.account.pin_failures, 0)
        self.assertIsNone(self.account.pin_locked_until)

    def test_password_change_validates_current_password_and_keeps_login(self):
        self.assertEqual(self.client.post('/api/auth/password/change/', {'current_password': 'wrong', 'new_password': 'New!OceanBright28'}).status_code, 400)
        self.assertEqual(self.client.post('/api/auth/password/change/', {'current_password': self.password, 'new_password': 'New!OceanBright28'}).status_code, 200)
        self.assertEqual(self.client.get('/api/dashboard/').status_code, 200)

    def test_password_change_revokes_other_sessions_and_pending_password_codes(self):
        other_token = issue_token(self.user)
        self.client.post('/api/auth/password/reset/request/', {'email': self.user.email})
        code = self.code()
        self.client.post('/api/security/pin/reset/request/')
        result = self.client.post('/api/auth/password/change/', {
            'current_password': self.password, 'new_password': 'New!OceanBright28',
        })
        self.assertEqual(result.status_code, 200)
        self.assertEqual(self.client.get('/api/dashboard/').status_code, 200)
        self.assertEqual(AccessSession.objects.filter(user=self.user).count(), 1)
        self.assertTrue(EmailChallenge.objects.filter(user=self.user, purpose='pin_reset').exists())
        self.client.credentials(HTTP_AUTHORIZATION='Bearer ' + other_token)
        self.assertEqual(self.client.get('/api/dashboard/').status_code, 401)
        self.client.credentials()
        self.assertEqual(self.client.post('/api/auth/password/reset/confirm/', {
            'email': self.user.email, 'code': code, 'password': 'Another!OceanBright29',
        }).status_code, 400)

    def test_login_cannot_issue_token_for_credentials_changed_during_authentication(self):
        from django.contrib.auth import authenticate

        self.client.credentials()
        for changes in ({'password': make_password('New!OceanBright28')},
                        {'is_active': False}, {'username': 'changed@example.test'}):
            with self.subTest(changes=list(changes)):
                User.objects.filter(pk=self.user.pk).update(
                    password=make_password(self.password), is_active=True, username=self.user.email,
                )
                AccessSession.objects.filter(user=self.user).delete()

                def changed_credentials(request, **credentials):
                    snapshot = authenticate(request, **credentials)
                    User.objects.filter(pk=self.user.pk).update(**changes)
                    return snapshot

                with patch('banking.views.authenticate', side_effect=changed_credentials):
                    result = self.client.post('/api/auth/login/', {
                        'email': self.user.email, 'password': self.password,
                    })
                self.assertEqual(result.status_code, 401)
                self.assertFalse(AccessSession.objects.filter(user=self.user).exists())

    def test_nominee_crud_minor_guardian_and_isolation(self):
        self.assertIsNone(self.client.get('/api/nominee/').data['nominee'])
        data = {'name': 'Child', 'relationship': 'Child', 'date_of_birth': str(timezone.localdate().replace(year=timezone.localdate().year - 10)), 'address': 'New Delhi', 'pin': '1234'}
        self.assertEqual(self.client.post('/api/nominee/', data).status_code, 400)
        data.update(guardian_name='Adult Guardian', guardian_relationship='Parent', guardian_address='New Delhi')
        self.assertEqual(self.client.post('/api/nominee/', data).status_code, 200)
        self.assertEqual(Nominee.objects.get(account=self.account).guardian_name, 'Adult Guardian')
        self.client.credentials(HTTP_AUTHORIZATION='Bearer ' + issue_token(self.other))
        self.assertIsNone(self.client.get('/api/nominee/').data['nominee'])
        self.client.credentials(HTTP_AUTHORIZATION='Bearer ' + self.token)
        self.assertEqual(self.client.delete('/api/nominee/', {'pin': '1234'}, format='json').status_code, 204)
        self.assertFalse(Nominee.objects.exists())

    def test_saved_recipients_validate_self_unknown_duplicate_and_isolation(self):
        self.assertEqual(self.client.post('/api/beneficiaries/', {'number': self.account.number}).status_code, 400)
        self.assertEqual(self.client.post('/api/beneficiaries/', {'number': '911111111111'}).status_code, 400)
        self.assertEqual(self.client.post('/api/beneficiaries/', {'number': self.other_account.number, 'nickname': 'Friend'}).status_code, 200)
        self.client.post('/api/beneficiaries/', {'number': self.other_account.number, 'nickname': 'Bob'})
        self.assertEqual(Beneficiary.objects.count(), 1)
        self.client.credentials(HTTP_AUTHORIZATION='Bearer ' + issue_token(self.other))
        self.assertEqual(self.client.get('/api/beneficiaries/').data['beneficiaries'], [])
        self.client.credentials(HTTP_AUTHORIZATION='Bearer ' + self.token)
        self.client.delete('/api/beneficiaries/', {'number': self.other_account.number}, format='json')
        self.assertFalse(Beneficiary.objects.exists())

    def test_saved_legacy_recipient_can_be_removed_when_frozen(self):
        Account.objects.filter(pk=self.other_account.pk).update(account_number=None, status=Account.Status.FROZEN)
        Beneficiary.objects.create(account=self.account, recipient=self.other_account)
        legacy_number = f'90{self.other_account.pk:010d}'
        result = self.client.delete('/api/beneficiaries/', {'number': legacy_number}, format='json')
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.data['beneficiaries'], [])
        self.assertFalse(Beneficiary.objects.filter(account=self.account).exists())

    def test_virtual_card_creation_is_idempotent_pin_protected_and_isolated(self):
        self.assertIsNone(self.client.get('/api/card/').data['card'])
        self.assertEqual(self.client.post('/api/card/', {'pin': '9999'}).status_code, 403)
        first = self.client.post('/api/card/', {'pin': '1234'})
        self.assertEqual(first.status_code, 200)
        self.assertEqual(self.client.post('/api/card/', {'pin': '1234'}).data, first.data)
        self.assertEqual(VirtualCard.objects.count(), 1)
        self.assertTrue(self.client.patch('/api/card/', {'pin': '1234', 'frozen': True}).data['card']['frozen'])
        self.client.credentials(HTTP_AUTHORIZATION='Bearer ' + issue_token(self.other))
        self.assertIsNone(self.client.get('/api/card/').data['card'])

    def test_support_request_validation_and_account_isolation(self):
        self.assertEqual(self.client.post('/api/support/', {'category': 'Payment', 'message': 'bad'}).status_code, 400)
        reply = self.client.post('/api/support/', {'category': 'Payment', 'message': 'My receipt is not appearing in the account.'})
        self.assertEqual(reply.status_code, 200)
        row = SupportRequest.objects.get(account=self.account)
        row.response = 'Please check the reference in activity.'
        row.status = 'Resolved'
        row.save()
        self.assertEqual(self.client.get('/api/support/').data['requests'][0]['status'], 'Resolved')
        self.client.credentials(HTTP_AUTHORIZATION='Bearer ' + issue_token(self.other))
        self.assertEqual(self.client.get('/api/support/').data['requests'], [])

    def test_persistent_login_has_thirty_day_lifetime(self):
        self.assertGreater(AccessSession.objects.get(user=self.user).expires_at, timezone.now() + timedelta(days=29))

    @override_settings(DEBUG=False, EMAIL_HOST='', EMAIL_BACKEND='django.core.mail.backends.smtp.EmailBackend')
    def test_unconfigured_email_is_explicitly_unavailable(self):
        self.assertEqual(self.client.post('/api/auth/password/reset/request/', {'email': self.user.email}).status_code, 503)
        self.assertEqual(self.client.post('/api/security/pin/reset/request/').status_code, 503)

    def test_all_customer_endpoints_require_login(self):
        self.client.credentials()
        for path in ['profile/', 'nominee/', 'beneficiaries/', 'card/', 'support/']:
            self.assertEqual(self.client.get('/api/' + path).status_code, 401, path)

    def test_browsing_settings_does_not_consume_security_write_throttle(self):
        for _ in range(35):
            self.assertEqual(self.client.get('/api/profile/').status_code, 200)
        self.assertEqual(self.client.patch('/api/profile/', {'name': 'Alice Updated'}).status_code, 200)

    @override_settings(DEBUG=False, RESEND_API_KEY='test-provider-key', EMAIL_BACKEND='banking.email_backend.ResendEmailBackend')
    @patch('banking.email_backend.requests.post')
    def test_https_recovery_delivery_uses_provider_and_never_returns_code(self, post):
        post.return_value.json.return_value = {'id': 'test-message'}
        result = self.client.post('/api/auth/password/reset/request/', {'email': self.user.email})
        self.assertEqual(result.status_code, 200)
        args, kwargs = post.call_args
        self.assertEqual(args, ('https://api.resend.com/emails',))
        self.assertEqual(kwargs['json']['to'], [self.user.email])
        code = re.search(r'code is ([0-9]{6})', kwargs['json']['text']).group(1)
        self.assertNotIn(code, str(result.data))
        self.assertTrue(check_password(code, EmailChallenge.objects.get(user=self.user).code_hash))
