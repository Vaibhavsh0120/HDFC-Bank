from decimal import Decimal
from uuid import uuid4

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from .authentication import issue_token
from .models import Account, Entry


class IncomingUpdatesTests(APITestCase):
    def setUp(self):
        user = User.objects.create_user(username="receiver", password="example-pass")
        sender = User.objects.create_user(username="sender", password="example-pass")
        self.account = Account.objects.create(owner=user)
        self.sender = Account.objects.create(owner=sender)
        self.client.credentials(HTTP_AUTHORIZATION="Bearer " + issue_token(user))

    def transfer(self, amount):
        return Entry.objects.create(
            initiator=self.sender, recipient=self.account, kind=Entry.Kind.TRANSFER,
            amount=Decimal(amount), request_id=uuid4(),
        )

    def test_baseline_and_new_transfers(self):
        old = self.transfer("1.00")
        baseline = self.client.get("/api/activity/updates/").data
        self.assertEqual(baseline["cursor"], old.pk)
        self.assertEqual(baseline["entries"], [])
        new = self.transfer("2.00")
        result = self.client.get("/api/activity/updates/", {"after": baseline["cursor"]}).data
        self.assertEqual(result["cursor"], new.pk)
        self.assertEqual([row["reference"] for row in result["entries"]], [str(new.reference)])
        self.assertEqual(result["entries"][0]["direction"], "credit")

    def test_dashboard_supplies_incoming_cursor_for_first_poll(self):
        old = self.transfer('1.00')
        dashboard = self.client.get('/api/dashboard/').data
        self.assertEqual(dashboard['incoming_cursor'], old.pk)
        new = self.transfer('2.00')
        result = self.client.get('/api/activity/updates/', {'after': dashboard['incoming_cursor']}).data
        self.assertEqual([row['reference'] for row in result['entries']], [str(new.reference)])

    def test_other_accounts_and_invalid_cursors(self):
        self.transfer("1.00")
        for cursor in ("-1", "NaN", "9" * 20):
            self.assertEqual(self.client.get("/api/activity/updates/", {"after": cursor}).status_code, 400)
        other = User.objects.create_user(username="other", password="example-pass")
        Account.objects.create(owner=other)
        self.client.credentials(HTTP_AUTHORIZATION="Bearer " + issue_token(other))
        self.assertEqual(self.client.get("/api/activity/updates/", {"after": "0"}).data["entries"], [])
