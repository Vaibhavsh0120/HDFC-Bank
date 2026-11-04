import secrets
import uuid
from decimal import Decimal

from django.conf import settings
from django.db import IntegrityError, models, transaction
from django.db.models import F, Q


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
