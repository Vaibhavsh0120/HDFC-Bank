from datetime import timedelta
from hashlib import sha256
from secrets import token_urlsafe

from django.utils import timezone
from rest_framework.authentication import BaseAuthentication, get_authorization_header
from rest_framework.exceptions import AuthenticationFailed

from .models import AccessSession


def issue_token(user):
    token = token_urlsafe(32)
    now = timezone.now()
    AccessSession.objects.filter(user=user, expires_at__lte=now).delete()
    AccessSession.objects.create(
        user=user, digest=sha256(token.encode()).hexdigest(), expires_at=now + timedelta(days=30),
    )
    return token


class BankingAuthentication(BaseAuthentication):
    def authenticate(self, request):
        header = get_authorization_header(request).split()
        if not header:
            return None
        if len(header) != 2 or header[0].lower() != b"bearer" or len(header[1]) != 43:
            raise AuthenticationFailed("Invalid session. Please sign in again.")
        digest = sha256(header[1]).hexdigest()
        session = AccessSession.objects.select_related("user").filter(
            digest=digest, expires_at__gt=timezone.now(), user__is_active=True,
        ).first()
        if session is None:
            raise AuthenticationFailed("Your session has ended. Please sign in again.")
        return session.user, session

    def authenticate_header(self, request):
        return "Bearer"
