from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from decimal import Decimal
from threading import Barrier
from unittest import skipUnless
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import connection, connections
from django.test import SimpleTestCase, TransactionTestCase
from django.utils import timezone
from rest_framework.test import APITestCase

from .models import AccessSession, Account, Entry
from .services import Instruction, InsufficientFunds, post_entry
from .structures import CircularBuffer, merge_ordered


class StructureTests(SimpleTestCase):
    def test_ring_wraps_in_insertion_order(self):
        ring = CircularBuffer(3)
        for item in range(8):
            ring.append(item)
        self.assertEqual(list(ring), [5, 6, 7])

    def test_merge_keeps_items_and_orders_duplicates(self):
        self.assertEqual(list(merge_ordered([1, 3, 9], [2, 3, 4], key=int)), [1, 2, 3, 3, 4, 9])
        self.assertEqual(list(merge_ordered([], [1], key=int)), [1])


class BankingTests(APITestCase):
    password = "Distinct!Ocean48"

    def setUp(self):
        cache.clear()
        self.alice = self.register("Alice Rao", "alice@example.test")
        self.bob = self.register("Bob Patel", "bob@example.test")

    def register(self, name, email):
        reply = self.client.post("/api/auth/register/", {"name": name, "email": email, "password": self.password})
        self.assertEqual(reply.status_code, 201, reply.data)
        return reply.data

    def authorize(self, session):
        self.client.credentials(HTTP_AUTHORIZATION="Bearer " + session["token"])

    def move(self, kind, amount, **extras):
        return self.client.post("/api/movements/", {"kind": kind, "amount": amount, "request_id": str(uuid4()), **extras})

    def test_registration_login_and_logout(self):
        self.assertEqual(Account.objects.count(), 2)
        self.assertNotEqual(self.alice["account"]["number"], self.bob["account"]["number"])
        self.assertEqual(self.client.get("/api/dashboard/").status_code, 401)
        credentials = {"email": "ALICE@example.test", "password": self.password}
        self.assertEqual(self.client.post("/api/auth/login/", {**credentials, "password": "wrong"}).status_code, 401)
        login = self.client.post("/api/auth/login/", credentials)
        self.assertEqual(login.status_code, 200)
        self.authorize(login.data)
        self.assertEqual(self.client.get("/api/dashboard/").data["account"]["balance"], "0.00")
        self.assertEqual(self.client.post("/api/auth/logout/").status_code, 204)
        self.assertEqual(self.client.get("/api/dashboard/").status_code, 401)
        self.authorize(self.alice)
        self.assertEqual(self.client.get("/api/dashboard/").status_code, 200)
        AccessSession.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.client.get("/api/dashboard/").status_code, 401)

    def test_registration_validation_and_duplicate(self):
        data = {"name": "Alice Rao", "email": "ALICE@example.test", "password": self.password}
        self.assertEqual(self.client.post("/api/auth/register/", data).status_code, 409)
        self.assertEqual(self.client.post("/api/auth/register/", {**data, "password": "password"}).status_code, 400)
        self.assertEqual(Account.objects.count(), 2)

    def test_validation_and_freeze(self):
        self.authorize(self.alice)
        for invalid in ("0", "-1", "0.001", "10000000000.00", "nan"):
            self.assertEqual(self.move("deposit", invalid).status_code, 400)
        self.assertEqual(self.move("withdraw", "1.00").status_code, 400)
        self.assertEqual(self.move("transfer", "1", recipient=self.alice["account"]["number"]).status_code, 400)
        Account.objects.filter(owner__username="alice@example.test").update(status=Account.Status.FROZEN)
        self.assertEqual(self.move("deposit", "10").status_code, 400)
        self.assertFalse(Entry.objects.exists())

    def test_transfer_retry_history_and_account_isolation(self):
        self.authorize(self.alice)
        self.assertEqual(self.move("deposit", "125.50").status_code, 201)
        number = self.bob["account"]["number"]
        lookup = self.client.post("/api/recipient/", {"number": number})
        self.assertEqual(lookup.data, {"name": "Bob Patel", "number": number})
        details = {"recipient": number, "description": "Lunch", "request_id": str(uuid4())}
        first = self.move("transfer", "20.25", **details)
        replay = self.move("transfer", "20.25", **details)
        self.assertEqual((first.status_code, replay.status_code), (201, 200))
        self.assertEqual(first.data["entry"]["reference"], replay.data["entry"]["reference"])
        self.assertEqual(self.move("transfer", "22", **details).status_code, 409)
        self.assertEqual(self.move("withdraw", "5").data["account"]["balance"], "100.25")

        self.authorize(self.bob)
        dashboard = self.client.get("/api/dashboard/").data
        self.assertEqual(dashboard["account"]["balance"], "20.25")
        self.assertEqual(len(dashboard["recent"]), 1)
        self.assertEqual(dashboard["recent"][0]["direction"], "credit")
        reference = first.data["entry"]["reference"]
        for query in ("Lunch", "Alice", self.alice["account"]["number"], reference):
            self.assertEqual(self.client.get("/api/history/", {"q": query, "kind": "transfer"}).data["count"], 1)
        self.assertEqual(self.client.get("/api/history/", {"kind": "deposit"}).data["count"], 0)
        self.assertEqual(Entry.objects.count(), 3)

    def test_transfer_rolls_back_when_recipient_cannot_accept_credit(self):
        self.authorize(self.alice)
        self.move("deposit", "100")
        Account.objects.filter(owner__username="bob@example.test").update(balance=Decimal("999999999999.99"))
        result = self.move("transfer", "10", recipient=self.bob["account"]["number"])
        self.assertEqual(result.status_code, 400)
        self.assertEqual(Account.objects.get(owner__username="alice@example.test").balance, Decimal("100.00"))
        self.assertEqual(Entry.objects.count(), 1)

    def test_ledger_failure_rolls_back_both_balances(self):
        source, target = Account.objects.order_by("pk")
        source.balance = Decimal("20")
        source.save(update_fields=["balance"])
        with patch("banking.services.Entry.objects.create", side_effect=RuntimeError("write failed")):
            with self.assertRaises(RuntimeError):
                post_entry(source.pk, Instruction("transfer", Decimal("10"), uuid4(), recipient_id=target.pk))
        source.refresh_from_db()
        target.refresh_from_db()
        self.assertEqual((source.balance, target.balance), (Decimal("20"), Decimal("0")))
        self.assertFalse(Entry.objects.exists())

    def test_mini_statement_bounds_and_merges_directions(self):
        source, target = Account.objects.order_by("pk")
        self.authorize(self.alice)
        for _ in range(10):
            self.move("deposit", "10")
        self.authorize(self.bob)
        self.move("deposit", "50")
        self.move("transfer", "1", recipient=source.number)
        self.authorize(self.alice)
        result = self.client.get("/api/dashboard/").data["recent"]
        self.assertEqual(len(result), 10)
        self.assertEqual(result[0]["kind"], "transfer")
        self.assertEqual(self.client.get("/api/history/").data["count"], 11)
        self.assertEqual(target.owner.first_name, "Bob Patel")

    def test_admin_rejects_customer_and_can_freeze_account(self):
        user_model = get_user_model()
        self.client.force_login(user_model.objects.get(username="alice@example.test"))
        self.assertEqual(self.client.get("/admin/banking/account/").status_code, 302)
        admin = user_model.objects.create_superuser("operator", password=self.password)
        self.client.force_login(admin)
        account = Account.objects.get(owner__username="alice@example.test")
        result = self.client.post(f"/admin/banking/account/{account.pk}/change/", {"status": "frozen"})
        self.assertEqual(result.status_code, 302)
        account.refresh_from_db()
        self.assertEqual(account.status, "frozen")


@skipUnless(connection.vendor == "mysql", "Uses real InnoDB row locks")
class ConcurrencyTests(TransactionTestCase):
    def test_simultaneous_debits_cannot_overdraw(self):
        owner = get_user_model().objects.create(username="parallel")
        account = Account.objects.create(owner=owner, balance=Decimal("50"))
        gate = Barrier(2)

        def attempt():
            try:
                gate.wait(timeout=10)
                post_entry(account.pk, Instruction("withdraw", Decimal("40"), uuid4()))
                return "posted"
            except InsufficientFunds:
                return "declined"
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertCountEqual(pool.map(lambda _: attempt(), range(2)), ["posted", "declined"])
        account.refresh_from_db()
        self.assertEqual(account.balance, Decimal("10"))
        self.assertEqual(Entry.objects.count(), 1)
