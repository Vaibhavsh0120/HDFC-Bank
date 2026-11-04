from abc import ABC, abstractmethod
from dataclasses import dataclass
from decimal import Decimal
from uuid import UUID

from django.db import transaction

from .models import Account, Entry
from .pin import verify_pin
from .structures import CircularBuffer, merge_ordered

MAX_BALANCE = Decimal("999999999999.99")
MAX_TRANSACTION = Decimal("9999999999.99")


class BankingError(Exception):
    status = 400


class InsufficientFunds(BankingError):
    pass


class AccountUnavailable(BankingError):
    pass


class DuplicateRequest(BankingError):
    status = 409


class PinRequired(BankingError):
    status = 403


class PinLocked(BankingError):
    status = 429


@dataclass(frozen=True)
class Instruction:
    kind: str
    amount: Decimal
    request_id: UUID
    description: str = ""
    recipient_id: int | None = None


class Movement(ABC):
    @abstractmethod
    def changes(self, source, target, amount):
        """Return account and signed balance change pairs."""


class Deposit(Movement):
    def changes(self, source, target, amount):
        return ((source, amount),)


class Withdrawal(Movement):
    def changes(self, source, target, amount):
        return ((source, -amount),)


class Transfer(Movement):
    def changes(self, source, target, amount):
        return ((source, -amount), (target, amount))


MOVEMENTS = {"deposit": Deposit(), "withdraw": Withdrawal(), "transfer": Transfer()}


def account_id(number):
    if len(number) != 12 or not number.startswith(("90", "91")) or not number.isascii() or not number.isdecimal():
        raise AccountUnavailable("Enter a valid 12-digit account number.")
    match = Account.objects.filter(account_number=number).values_list("pk", flat=True).first()
    if match is None and number.startswith("90"):
        match = Account.objects.filter(
            pk=int(number[2:]), account_number__isnull=True,
        ).values_list("pk", flat=True).first()
    if match is None:
        raise AccountUnavailable("This recipient account is unavailable.")
    return match


def recipient_for(source_id, number):
    target_id = account_id(number)
    if target_id == source_id:
        raise AccountUnavailable("Choose an account other than your own.")
    target = Account.objects.select_related("owner").filter(
        pk=target_id, status=Account.Status.ACTIVE, owner__is_active=True,
    ).first()
    if target is None:
        raise AccountUnavailable("This recipient account is unavailable.")
    return target


def post_entry(source_id, instruction, *, pin=None):
    existing = Entry.objects.filter(
        initiator_id=source_id, request_id=instruction.request_id,
    ).exists()
    if instruction.kind in (Entry.Kind.WITHDRAW, Entry.Kind.TRANSFER) and not existing:
        if not pin:
            if not Account.objects.filter(pk=source_id, pin_hash__gt="").exists():
                raise PinRequired("Set a transaction PIN before continuing.")
            raise BankingError("Enter your transaction PIN.")
        try:
            result = verify_pin(source_id, pin)
        except Account.DoesNotExist as exc:
            raise AccountUnavailable("The account is unavailable.") from exc
        if result == "not_configured":
            raise PinRequired("Set a transaction PIN before continuing.")
        if result == "locked":
            raise PinLocked("Too many incorrect PIN attempts. Try again in 15 minutes.")
        if result != "ok":
            raise BankingError("Incorrect transaction PIN.")
    return _post_entry(source_id, instruction)


@transaction.atomic
def _post_entry(source_id, instruction):
    target_id = instruction.recipient_id
    if instruction.kind not in MOVEMENTS:
        raise BankingError("Unknown transaction type.")
    if (instruction.kind == Entry.Kind.TRANSFER) != (target_id is not None):
        raise BankingError("A recipient is required only for transfers.")
    amount = instruction.amount
    if (
        not isinstance(amount, Decimal)
        or not amount.is_finite()
        or amount <= 0
        or amount > MAX_TRANSACTION
        or amount.as_tuple().exponent < -2
    ):
        raise BankingError("Enter a valid amount with at most two decimal places.")
    if not isinstance(instruction.request_id, UUID):
        raise BankingError("A valid request reference is required.")
    if not isinstance(instruction.description, str) or len(instruction.description) > 140:
        raise BankingError("The description must be at most 140 characters.")
    if source_id == target_id:
        raise AccountUnavailable("Choose an account other than your own.")
    ids = {source_id} if target_id is None else {source_id, target_id}
    accounts = {}
    # Point locks acquired in the same order for every operation.
    for pk in sorted(ids):
        account = Account.objects.select_for_update().filter(pk=pk).first()
        if account is not None:
            accounts[pk] = account
    existing = Entry.objects.filter(initiator_id=source_id, request_id=instruction.request_id).first()
    if existing:
        if (existing.kind, existing.amount, existing.recipient_id, existing.description) != (
            instruction.kind, instruction.amount, target_id, instruction.description,
        ):
            raise DuplicateRequest("This request reference already belongs to another transaction.")
        return existing, False
    if accounts.keys() != ids or any(a.status != Account.Status.ACTIVE for a in accounts.values()):
        raise AccountUnavailable("One of the accounts is unavailable for transactions.")
    if target_id is not None and not accounts[target_id].owner.is_active:
        raise AccountUnavailable("The recipient account is unavailable.")

    changes = MOVEMENTS[instruction.kind].changes(accounts[source_id], accounts.get(target_id), instruction.amount)
    for account, delta in changes:
        account.balance += delta
        if account.balance < 0:
            raise InsufficientFunds("Your available balance is too low for this transaction.")
        if account.balance > MAX_BALANCE:
            raise BankingError("This transaction would exceed the account balance limit.")
        account.save(update_fields=["balance"])
    entry = Entry.objects.create(
        initiator_id=source_id, recipient_id=target_id, kind=instruction.kind,
        amount=instruction.amount, description=instruction.description,
        request_id=instruction.request_id,
    )
    return entry, True


def mini_statement(account, limit=10):
    fields = ("initiator__owner", "recipient__owner")
    outgoing = list(account.outgoing.select_related(*fields)[:limit])
    incoming = list(account.incoming.select_related(*fields)[:limit])
    recent = CircularBuffer(limit)
    for entry in merge_ordered(reversed(outgoing), reversed(incoming), key=lambda row: (row.created_at, row.pk)):
        recent.append(entry)
    return list(reversed(list(recent)))
