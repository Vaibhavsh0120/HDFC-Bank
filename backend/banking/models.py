import uuid
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.db.models import F, Q


class Account(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        FROZEN = "frozen", "Frozen"

    owner = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    balance = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0.00"))
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.ACTIVE)
    created_at = models.DateTimeField(auto_now_add=True)

    @property
    def number(self):
        return f"90{self.pk:010d}"

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
