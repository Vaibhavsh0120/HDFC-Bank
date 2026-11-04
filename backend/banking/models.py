import secrets
import uuid
from decimal import Decimal

from django.conf import settings
from django.db import IntegrityError, models, transaction
from django.db.models import F, Q
from django.utils import timezone


def generate_account_number():
    return f"91{secrets.randbelow(10**10):010d}"


class Account(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        FROZEN = "frozen", "Frozen"

    owner = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    account_number = models.CharField(
        max_length=12, unique=True, null=True, editable=False, default=generate_account_number,
    )
    balance = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0.00"))
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.ACTIVE)
    pin_hash = models.CharField(max_length=128, blank=True, editable=False)
    pin_failures = models.PositiveSmallIntegerField(default=0, editable=False)
    pin_locked_until = models.DateTimeField(null=True, blank=True, editable=False)
    phone = models.CharField(max_length=16, blank=True)
    address = models.CharField(max_length=300, blank=True)
    payment_locked = models.BooleanField(default=False)
    transfer_alerts = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    @property
    def number(self):
        return self.account_number or f"90{self.pk:010d}"

    def save(self, *args, **kwargs):
        if not self._state.adding:
            return super().save(*args, **kwargs)
        # A savepoint makes an unlikely unique-number collision retryable inside
        # the registration transaction without masking unrelated integrity errors.
        for _ in range(10):
            try:
                with transaction.atomic():
                    return super().save(*args, **kwargs)
            except IntegrityError:
                if not Account.objects.filter(account_number=self.account_number).exists():
                    raise
                self.account_number = generate_account_number()
        raise IntegrityError("Unable to allocate a unique account number.")

    class Meta:
        constraints = [models.CheckConstraint(condition=Q(balance__gte=0), name="balance_nonnegative")]

    def __str__(self):
        return self.number


class Entry(models.Model):
    recipient_id: int | None

    class Kind(models.TextChoices):
        DEPOSIT = "deposit", "Deposit"
        WITHDRAW = "withdraw", "Withdrawal"
        TRANSFER = "transfer", "Transfer"

    reference = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    request_id = models.UUIDField(editable=False)
    initiator = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="outgoing")
    recipient = models.ForeignKey(
        Account, null=True, blank=True, on_delete=models.PROTECT, related_name="incoming",
    )
    kind = models.CharField(max_length=10, choices=Kind.choices)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    description = models.CharField(max_length=140, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ("-created_at", "-pk")
        constraints = [
            models.UniqueConstraint(fields=["initiator", "request_id"], name="unique_account_request"),
            models.CheckConstraint(condition=Q(amount__gt=0), name="entry_amount_positive"),
            models.CheckConstraint(
                condition=(
                    Q(kind="transfer", recipient__isnull=False) & ~Q(initiator=F("recipient"))
                ) | Q(kind__in=("deposit", "withdraw"), recipient__isnull=True),
                name="entry_valid_participants",
            ),
        ]

    def __str__(self):
        return str(self.reference)


class AccessSession(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    digest = models.CharField(max_length=64, unique=True)
    expires_at = models.DateTimeField()


class GoogleIdentity(models.Model):
    subject_hash = models.CharField(max_length=64, unique=True)
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)


class EmailChallenge(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    purpose = models.CharField(max_length=20)
    email = models.EmailField(max_length=150)
    code_hash = models.CharField(max_length=128)
    failures = models.PositiveSmallIntegerField(default=0)
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)


class Nominee(models.Model):
    account = models.OneToOneField(Account, on_delete=models.CASCADE)
    name = models.CharField(max_length=150)
    relationship = models.CharField(max_length=40)
    date_of_birth = models.DateField()
    address = models.CharField(max_length=300)
    guardian_name = models.CharField(max_length=150, blank=True)
    guardian_relationship = models.CharField(max_length=40, blank=True)
    guardian_address = models.CharField(max_length=300, blank=True)
    updated_at = models.DateTimeField(auto_now=True)


class Beneficiary(models.Model):
    account = models.ForeignKey(Account, on_delete=models.CASCADE, related_name='beneficiaries')
    recipient = models.ForeignKey(Account, on_delete=models.PROTECT, related_name='+')
    nickname = models.CharField(max_length=80, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['account', 'recipient'], name='unique_beneficiary')]


class VirtualCard(models.Model):
    class Network(models.TextChoices):
        VISA = 'visa', 'VISA'
        RUPAY = 'rupay', 'RuPay'
        MASTERCARD = 'mastercard', 'Mastercard'

    account = models.OneToOneField(Account, on_delete=models.CASCADE)
    identifier = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    network = models.CharField(max_length=10, choices=Network.choices, default=Network.VISA)
    number = models.CharField(max_length=16, unique=True, editable=False)
    security_code = models.CharField(max_length=3, editable=False)
    frozen = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    issued_at = models.DateTimeField(default=timezone.now)

    def save(self, *args, **kwargs):
        if not self.number:
            from .cards import card_details
            self.number, self.security_code = card_details(self.network)
        super().save(*args, **kwargs)


class SupportRequest(models.Model):
    account = models.ForeignKey(Account, on_delete=models.PROTECT)
    reference = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    category = models.CharField(max_length=30)
    message = models.CharField(max_length=2000)
    status = models.CharField(max_length=20, default='Open')
    response = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
