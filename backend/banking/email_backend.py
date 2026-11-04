"""HTTPS transactional email delivery for hosts that block outbound SMTP."""
import requests
from django.conf import settings
from django.core.mail.backends.base import BaseEmailBackend


class ResendEmailBackend(BaseEmailBackend):
    def send_messages(self, email_messages):
        sent = 0
        for message in email_messages:
            try:
                response = requests.post(
                    'https://api.resend.com/emails',
                    headers={'Authorization': 'Bearer ' + settings.RESEND_API_KEY, 'User-Agent': 'bank-student-project/1.0'},
                    json={'from': message.from_email, 'to': message.to, 'subject': message.subject, 'text': message.body},
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
