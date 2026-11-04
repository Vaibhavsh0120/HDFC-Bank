"""HTTPS transactional email delivery for hosts that block outbound SMTP."""
import requests
from email.utils import parseaddr
from django.conf import settings
from django.core.mail.backends.base import BaseEmailBackend


def html_body(message):
    return next((content for content, content_type in getattr(message, 'alternatives', [])
                 if content_type == 'text/html'), None)


class ResendEmailBackend(BaseEmailBackend):
    def send_messages(self, email_messages):
        sent = 0
        for message in email_messages:
            try:
                response = requests.post(
                    'https://api.resend.com/emails',
                    headers={'Authorization': 'Bearer ' + settings.RESEND_API_KEY, 'User-Agent': 'bank-student-project/1.0'},
                    json={'from': message.from_email, 'to': message.to, 'subject': message.subject,
                          'text': message.body, **({'html': html_body(message)} if html_body(message) else {})},
                    timeout=settings.EMAIL_TIMEOUT,
                )
                response.raise_for_status()
                if not response.json().get('id'):
                    raise RuntimeError('Email provider did not accept the message.')
                sent += 1
            except (requests.RequestException, ValueError, RuntimeError):
                if not self.fail_silently:
                    raise
        return sent


class BrevoEmailBackend(BaseEmailBackend):
    """Transactional recovery mail over HTTPS; no SMTP connection required."""

    def send_messages(self, email_messages):
        sent = 0
        for message in email_messages:
            try:
                name, address = parseaddr(message.from_email)
                response = requests.post(
                    'https://api.brevo.com/v3/smtp/email',
                    headers={'api-key': settings.BREVO_API_KEY, 'Accept': 'application/json'},
                    json={'sender': {'name': name or 'Account recovery', 'email': address},
                          'to': [{'email': email} for email in message.to],
                          'subject': message.subject, 'textContent': message.body,
                          **({'htmlContent': html_body(message)} if html_body(message) else {})},
                    timeout=settings.EMAIL_TIMEOUT,
                )
                response.raise_for_status()
                if not response.json().get('messageId'):
                    raise RuntimeError('Email provider did not accept the message.')
                sent += 1
            except (requests.RequestException, ValueError, RuntimeError):
                if not self.fail_silently:
                    raise
        return sent
