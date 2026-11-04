from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from decimal import Decimal
from threading import Barrier
from unittest import skipUnless
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth.models import User
from django.contrib.auth.hashers import check_password, make_password
from django.core.cache import cache
from django.db import connection, connections
from importlib import import_module
from django.test import SimpleTestCase, TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APITestCase
from google.auth.exceptions import TransportError

from .models import AccessSession, Account, Entry, GoogleIdentity
from .services import BankingError, Instruction, InsufficientFunds, post_entry
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


class AccountNumberMigrationTests(TransactionTestCase):
    def test_existing_account_number_is_preserved(self):
        from django.apps import apps

        user = User.objects.create(username="migration-customer")
        account = Account.objects.create(owner=user)
        Account.objects.filter(pk=account.pk).update(account_number=None)
        expected = f"90{account.pk:010d}"
        migration = import_module("banking.migrations.0003_account_numbers")
        with connection.schema_editor() as editor:
            migration.preserve_account_numbers(apps, editor)
        account.refresh_from_db()
        self.assertEqual(account.account_number, expected)


class BankingTests(APITestCase):
    password = "Distinct!Ocean48"

    def setUp(self):
        cache.clear()
        self.alice = self.register("Alice Rao", "alice@example.test")
        self.bob = self.register("Bob Patel", "bob@example.test")
        Account.objects.update(pin_hash=make_password("1234"))

    def register(self, name, email):
        reply = self.client.post("/api/auth/register/", {"name": name, "email": email, "password": self.password})
        self.assertEqual(reply.status_code, 201, reply.data)
        return reply.data

    def authorize(self, session):
        self.client.credentials(HTTP_AUTHORIZATION="Bearer " + session["token"])

    def move(self, kind, amount, **extras):
        return self.client.post("/api/movements/", {
            "kind": kind, "amount": amount, "request_id": str(uuid4()),
            **({"pin": "1234"} if kind in ("withdraw", "transfer") else {}),
            **extras,
        })

    def test_registration_login_and_logout(self):
        self.assertEqual(Account.objects.count(), 2)
        self.assertNotEqual(self.alice["account"]["number"], self.bob["account"]["number"])
        self.assertTrue(self.alice["account"]["number"].startswith("91"))
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

    def test_account_numbers_are_random_and_collision_is_retried(self):
        used = int(self.alice["account"]["number"][2:])
        available = (used + 1) % 10**10
        with patch("banking.models.secrets.randbelow", side_effect=[used, available]):
            created = self.register("Charlie", "charlie@example.test")
        self.assertEqual(created["account"]["number"], f"91{available:010d}")
        self.assertNotEqual(created["account"]["number"], self.alice["account"]["number"])

    def test_legacy_number_remains_usable_for_transfers(self):
        target = Account.objects.get(owner__username="bob@example.test")
        Account.objects.filter(pk=target.pk).update(account_number=None)
        target.refresh_from_db()
        legacy_number = f"90{target.pk:010d}"
        self.assertEqual(target.number, legacy_number)
        self.authorize(self.alice)
        self.move("deposit", "30")
        self.assertEqual(self.client.post("/api/recipient/", {"number": f"91{target.pk:010d}"}).status_code, 400)
        self.assertEqual(self.client.post("/api/recipient/", {"number": legacy_number}).status_code, 200)
        transfer = self.move("transfer", "10", recipient=legacy_number)
        self.assertEqual(transfer.status_code, 201)
        self.assertEqual(transfer.data["entry"]["counterparty"]["number"], legacy_number)
        self.assertEqual(self.client.get("/api/history/", {"q": legacy_number}).data["count"], 1)

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

    def test_pin_setup_and_debit_requirement(self):
        self.authorize(self.alice)
        Account.objects.filter(owner__username="alice@example.test").update(pin_hash="")
        self.assertEqual(self.client.get("/api/security/pin/").data["configured"], False)
        self.assertEqual(self.move("deposit", "20").status_code, 201)
        self.assertEqual(self.move("withdraw", "5").status_code, 403)
        for invalid in ("123", "1234567", "12a4", " 1234 "):
            self.assertEqual(self.client.post("/api/security/pin/", {"pin": invalid}).status_code, 400)
        response = self.client.post("/api/security/pin/", {"pin": "5678"})
        self.assertEqual(response.data["configured"], True)
        account = Account.objects.get(owner__username="alice@example.test")
        self.assertNotEqual(account.pin_hash, "5678")
        self.assertTrue(check_password("5678", account.pin_hash))
        self.assertEqual(self.client.post("/api/security/pin/", {"pin": "1111"}).status_code, 409)
        self.assertEqual(self.move("withdraw", "5", pin="5678").status_code, 201)

    def test_pin_failures_persist_and_lock_out_debits(self):
        self.authorize(self.alice)
        self.move("deposit", "100")
        for _ in range(4):
            self.assertEqual(self.move("withdraw", "1", pin="9999").status_code, 400)
        self.assertEqual(self.move("withdraw", "1", pin="9999").status_code, 429)
        self.assertEqual(self.move("withdraw", "1", pin="1234").status_code, 429)
        self.assertIsNotNone(self.client.get("/api/security/pin/").data["locked_until"])
        account = Account.objects.get(owner__username="alice@example.test")
        self.assertEqual(account.pin_failures, 5)
        self.assertEqual(account.balance, Decimal("100.00"))
        Account.objects.filter(pk=account.pk).update(pin_locked_until=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.move("withdraw", "1").status_code, 201)
        account.refresh_from_db()
        self.assertEqual(account.pin_failures, 0)
        self.assertIsNone(account.pin_locked_until)

    def test_completed_debit_can_be_replayed_without_pin(self):
        self.authorize(self.alice)
        self.move("deposit", "20")
        request_id = str(uuid4())
        result = self.move("withdraw", "5", request_id=request_id)
        self.assertEqual(result.status_code, 201)
        replay = self.client.post("/api/movements/", {
            "kind": "withdraw", "amount": "5", "request_id": request_id,
        })
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.data["entry"]["reference"], result.data["entry"]["reference"])
        self.assertEqual(replay.data["account"]["balance"], "15.00")
        changed = self.client.post("/api/movements/", {
            "kind": "withdraw", "amount": "6", "request_id": request_id,
        })
        self.assertEqual(changed.status_code, 409)

    def test_pin_change_requires_current_pin_and_shares_lockout(self):
        self.authorize(self.alice)
        self.assertEqual(self.client.patch("/api/security/pin/", {
            "current_pin": "9999", "new_pin": "5678",
        }).status_code, 400)
        account = Account.objects.get(owner__username="alice@example.test")
        self.assertEqual(account.pin_failures, 1)
        self.assertTrue(check_password("1234", account.pin_hash))
        self.assertEqual(self.client.patch("/api/security/pin/", {
            "current_pin": "1234", "new_pin": "12a4",
        }).status_code, 400)
        result = self.client.patch("/api/security/pin/", {
            "current_pin": "1234", "new_pin": "5678",
        })
        self.assertEqual(result.status_code, 200)
        account.refresh_from_db()
        self.assertEqual(account.pin_failures, 0)
        self.assertTrue(check_password("5678", account.pin_hash))
        self.assertFalse(check_password("1234", account.pin_hash))
        for _ in range(5):
            self.client.patch("/api/security/pin/", {"current_pin": "1111", "new_pin": "2222"})
        self.assertEqual(self.client.patch("/api/security/pin/", {
            "current_pin": "5678", "new_pin": "2222",
        }).status_code, 429)
        account.refresh_from_db()
        self.assertTrue(check_password("5678", account.pin_hash))

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

    def test_retry_after_account_freeze_returns_original_entry(self):
        self.authorize(self.alice)
        request_id = str(uuid4())
        first = self.move("deposit", "20", request_id=request_id)
        Account.objects.filter(owner__username="alice@example.test").update(status=Account.Status.FROZEN)
        repeated = self.move("deposit", "20", request_id=request_id)
        self.assertEqual(repeated.status_code, 200)
        self.assertEqual(repeated.data["entry"], first.data["entry"])
        self.assertEqual(repeated.data["account"]["status"], "Frozen")
        self.assertEqual(repeated.data["account"]["balance"], "20.00")
        self.assertEqual(Entry.objects.count(), 1)

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
                post_entry(source.pk, Instruction("transfer", Decimal("10"), uuid4(), recipient_id=target.pk), pin="1234")
        source.refresh_from_db()
        target.refresh_from_db()
        self.assertEqual((source.balance, target.balance), (Decimal("20"), Decimal("0")))
        self.assertFalse(Entry.objects.exists())

    def test_service_rejects_invalid_instructions_without_mutating_balance(self):
        source, target = Account.objects.order_by("pk")
        source.balance = Decimal("100.00")
        source.save(update_fields=["balance"])
        instructions = [
            Instruction("deposit", Decimal("-1"), uuid4()),
            Instruction("withdraw", Decimal("NaN"), uuid4()),
            Instruction("deposit", Decimal("0.001"), uuid4()),
            Instruction("deposit", Decimal("10000000000"), uuid4()),
            Instruction("transfer", Decimal("1"), uuid4()),
            Instruction("deposit", Decimal("1"), uuid4(), recipient_id=target.pk),
            Instruction("unknown", Decimal("1"), uuid4()),
        ]
        for instruction in instructions:
            with self.subTest(instruction=instruction), self.assertRaises(BankingError):
                post_entry(source.pk, instruction)
        source.refresh_from_db()
        self.assertEqual(source.balance, Decimal("100.00"))
        self.assertFalse(Entry.objects.exists())

    def test_private_api_responses_are_not_cached(self):
        self.authorize(self.alice)
        for path in ("/api/dashboard/", "/api/history/"):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200)
            self.assertIn("no-store", response["Cache-Control"])

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
        user_model = User
        self.client.force_login(user_model.objects.get(username="alice@example.test"))
        self.assertEqual(self.client.get("/admin/banking/account/").status_code, 302)
        admin = user_model.objects.create_superuser("operator", email="operator@example.test", password=self.password)
        self.client.force_login(admin)
        account = Account.objects.get(owner__username="alice@example.test")
        result = self.client.post(f"/admin/banking/account/{account.pk}/change/", {"status": "frozen"})
        self.assertEqual(result.status_code, 302)
        account.refresh_from_db()
        self.assertEqual(account.status, "frozen")


@override_settings(GOOGLE_CLIENT_ID="test-client.apps.googleusercontent.com")
class GoogleSignInTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.claims = {
            "iss": "https://accounts.google.com", "sub": "google-subject-123",
            "email": "alex@example.test", "email_verified": True, "name": "Alex",
        }

    def test_provisions_once_and_uses_subject(self):
        with patch("banking.views.id_token.verify_oauth2_token", return_value=self.claims) as verify:
            first = self.client.post("/api/auth/google/", {"credential": "signed-token"})
            self.assertEqual(first.status_code, 200)
            self.assertEqual(first.data["account"]["email"], "alex@example.test")
            self.assertEqual(first.data["account"]["balance"], "0.00")
            verify.assert_called_once()
            self.assertEqual(verify.call_args.args[2], "test-client.apps.googleusercontent.com")
            changed_email = {**self.claims, "email": "new@example.test"}
        with patch("banking.views.id_token.verify_oauth2_token", return_value=changed_email):
            second = self.client.post("/api/auth/google/", {"credential": "signed-token"})
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.data["account"]["number"], second.data["account"]["number"])
        self.assertEqual(GoogleIdentity.objects.count(), 1)
        self.assertEqual(Account.objects.count(), 1)
        user = GoogleIdentity.objects.get().user
        self.assertFalse(user.has_usable_password())

    def test_existing_password_account_is_not_automatically_linked(self):
        user = User.objects.create_user(
            username="alex@example.test", email="alex@example.test", password="Existing!Pass99",
        )
        Account.objects.create(owner=user)
        with patch("banking.views.id_token.verify_oauth2_token", return_value=self.claims):
            result = self.client.post("/api/auth/google/", {"credential": "signed-token"})
        self.assertEqual(result.status_code, 409)
        self.assertFalse(GoogleIdentity.objects.exists())

    def test_invalid_and_unverified_tokens_are_rejected(self):
        with patch("banking.views.id_token.verify_oauth2_token", side_effect=ValueError("bad signature")):
            self.assertEqual(self.client.post("/api/auth/google/", {"credential": "bad"}).status_code, 401)
        for claims in (
            {**self.claims, "email_verified": False},
            {**self.claims, "iss": "https://attacker.example"},
            {**self.claims, "sub": ""},
            {**self.claims, "email": "invalid"},
        ):
            with patch("banking.views.id_token.verify_oauth2_token", return_value=claims):
                self.assertEqual(self.client.post("/api/auth/google/", {"credential": "signed-token"}).status_code, 401)
        self.assertFalse(Account.objects.exists())

    @override_settings(GOOGLE_CLIENT_ID="")
    def test_configuration_is_optional(self):
        self.assertEqual(self.client.get("/api/auth/google/config/").data["client_id"], "")
        self.assertEqual(self.client.post("/api/auth/google/", {"credential": "token"}).status_code, 503)

    def test_inactive_user_and_provider_failure(self):
        with patch("banking.views.id_token.verify_oauth2_token", return_value=self.claims):
            self.assertEqual(self.client.post("/api/auth/google/", {"credential": "token"}).status_code, 200)
            user = GoogleIdentity.objects.get().user
            user.is_active = False
            user.save(update_fields=["is_active"])
            self.assertEqual(self.client.post("/api/auth/google/", {"credential": "token"}).status_code, 403)
        with patch("banking.views.id_token.verify_oauth2_token", side_effect=TransportError("offline")):
            self.assertEqual(self.client.post("/api/auth/google/", {"credential": "token"}).status_code, 503)


@skipUnless(connection.vendor == "mysql", "Uses real InnoDB row locks")
class ConcurrencyTests(TransactionTestCase):
    def test_simultaneous_debits_cannot_overdraw(self):
        owner = User.objects.create(username="parallel")
        account = Account.objects.create(owner=owner, balance=Decimal("50"), pin_hash=make_password("1234"))
        gate = Barrier(2)

        def attempt():
            try:
                gate.wait(timeout=10)
                post_entry(account.pk, Instruction("withdraw", Decimal("40"), uuid4()), pin="1234")
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

    def test_concurrent_retries_post_once(self):
        owner = User.objects.create(username="retry")
        account = Account.objects.create(owner=owner, balance=Decimal("0"))
        request_id = uuid4()
        gate = Barrier(2)

        def attempt():
            try:
                gate.wait(timeout=10)
                entry, created = post_entry(account.pk, Instruction("deposit", Decimal("40"), request_id))
                return entry.reference, created
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: attempt(), range(2)))
        self.assertEqual(results[0][0], results[1][0])
        self.assertCountEqual([created for _, created in results], [True, False])
        account.refresh_from_db()
        self.assertEqual(account.balance, Decimal("40"))
        self.assertEqual(Entry.objects.count(), 1)
