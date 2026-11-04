from hashlib import sha256
from unittest.mock import patch

from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from .authentication import issue_token
from .models import Account, AccessSession, GoogleIdentity


@override_settings(GOOGLE_CLIENT_ID='test-client.apps.googleusercontent.com')
class SignInMethodsTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.password = 'Ocean!Bright427'
        self.user = User.objects.create_user(username='alice@example.test', email='alice@example.test', password=self.password)
        Account.objects.create(owner=self.user)
        self.client.credentials(HTTP_AUTHORIZATION='Bearer ' + issue_token(self.user))
        self.claims = {'iss': 'https://accounts.google.com', 'sub': 'shared-google',
                       'email': 'google@example.test', 'email_verified': True,
                       'iat': int(timezone.now().timestamp())}

    def identity(self):
        return GoogleIdentity.objects.create(user=self.user, subject_hash=sha256(b'shared-google').hexdigest())

    @patch('banking.views.id_token.verify_oauth2_token')
    def test_link_requires_password_and_verified_google_then_both_methods_work(self, verify):
        verify.return_value = self.claims
        body = {'credential': 'signed-token', 'current_password': 'wrong'}
        self.assertEqual(self.client.post('/api/auth/google/link/', body).status_code, 400)
        self.assertFalse(GoogleIdentity.objects.exists())
        body['current_password'] = self.password
        result = self.client.post('/api/auth/google/link/', body)
        self.assertEqual(result.status_code, 200, result.data)
        self.assertTrue(result.data['google_linked'])
        self.assertTrue(result.data['has_password'])
        self.assertEqual(self.client.post('/api/auth/google/', {'credential': 'signed-token'}).data['account']['number'], self.user.account.number)
        self.assertEqual(self.client.post('/api/auth/login/', {'email': self.user.email, 'password': self.password}).status_code, 200)

    @patch('banking.views.id_token.verify_oauth2_token')
    def test_cannot_link_google_identity_belonging_to_another_user(self, verify):
        verify.return_value = self.claims
        other = User.objects.create_user(username='other@example.test', password=self.password)
        GoogleIdentity.objects.create(user=other, subject_hash=sha256(b'shared-google').hexdigest())
        self.assertEqual(self.client.post('/api/auth/google/link/', {'credential': 'token', 'current_password': self.password}).status_code, 409)
        self.assertFalse(GoogleIdentity.objects.filter(user=self.user).exists())

    def test_cannot_remove_last_method_and_unlink_requires_password(self):
        self.identity()
        self.assertEqual(self.client.post('/api/auth/google/unlink/', {'current_password': 'wrong'}).status_code, 400)
        self.user.set_unusable_password()
        self.user.save()
        self.assertEqual(self.client.post('/api/auth/google/unlink/', {'current_password': self.password}).status_code, 409)
        self.assertTrue(GoogleIdentity.objects.filter(user=self.user).exists())
        self.user.set_password(self.password)
        self.user.save()
        other_session = issue_token(self.user)
        result = self.client.post('/api/auth/google/unlink/', {'current_password': self.password})
        self.assertEqual(result.status_code, 200)
        self.assertFalse(result.data['google_linked'])
        self.assertEqual(AccessSession.objects.filter(user=self.user).count(), 1)
        self.assertEqual(self.client.get('/api/dashboard/').status_code, 200)

    @patch('banking.views.id_token.verify_oauth2_token')
    def test_google_only_add_password_requires_matching_fresh_identity(self, verify):
        self.identity()
        self.user.set_unusable_password()
        self.user.save()
        body = {'credential': 'token', 'new_password': 'Brighter!Ocean972'}
        for claims in [{**self.claims, 'sub': 'someone-else'}, {**self.claims, 'iat': 1}, {**self.claims, 'email_verified': False}]:
            verify.return_value = claims
            self.assertIn(self.client.post('/api/auth/password/add/', body).status_code, [400, 401, 403])
            self.user.refresh_from_db()
            self.assertFalse(self.user.has_usable_password())
        verify.return_value = self.claims
        result = self.client.post('/api/auth/password/add/', body)
        self.assertEqual(result.status_code, 200, result.data)
        self.assertTrue(result.data['has_password'])
        self.assertTrue(result.data['google_linked'])
        self.assertEqual(self.client.get('/api/dashboard/').status_code, 200)
        self.assertEqual(self.client.post('/api/auth/login/', {'email': self.user.email, 'password': body['new_password']}).status_code, 200)
        self.assertEqual(self.client.post('/api/auth/password/add/', body).status_code, 409)

    def test_method_changes_require_login(self):
        self.client.credentials()
        for path in ['auth/google/link/', 'auth/google/unlink/', 'auth/password/add/']:
            self.assertEqual(self.client.post('/api/' + path, {}).status_code, 401)
