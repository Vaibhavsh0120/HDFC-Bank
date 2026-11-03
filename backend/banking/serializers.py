from decimal import Decimal

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from .models import Entry

User = get_user_model()


class RegistrationSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=150)
    email = serializers.EmailField(max_length=150)
    password = serializers.CharField(max_length=128, write_only=True, trim_whitespace=False)

    def validate(self, data):
        email = data["email"].lower()
        try:
            validate_password(data["password"], User(username=email, email=email, first_name=data["name"]))
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"password": exc.messages}) from exc
        return {**data, "email": email}


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=150)
    password = serializers.CharField(max_length=128, trim_whitespace=False)


class GoogleCredentialSerializer(serializers.Serializer):
    credential = serializers.CharField(max_length=16384, trim_whitespace=False)


class InstructionSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=Entry.Kind.choices)
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"))
    request_id = serializers.UUIDField()
    recipient = serializers.RegexField(regex=r"^90[0-9]{10}$", required=False)
    description = serializers.CharField(max_length=140, allow_blank=True, default="")

    def validate(self, data):
        if (data["kind"] == Entry.Kind.TRANSFER) != ("recipient" in data):
            raise serializers.ValidationError({"recipient": "A recipient is required only for transfers."})
        return data


def account_data(account):
    return {
        "name": account.owner.first_name or account.owner.get_username(),
        "email": account.owner.email,
        "number": account.number,
        "type": "Savings",
        "balance": str(account.balance),
        "status": account.get_status_display(),
        "created_at": account.created_at.isoformat(),
    }


def entry_data(entry, account_id):
    credit = entry.kind == Entry.Kind.DEPOSIT or entry.recipient_id == account_id
    counterparty = None
    if entry.kind == Entry.Kind.TRANSFER:
        other = entry.initiator if credit else entry.recipient
        counterparty = {"name": other.owner.first_name, "number": other.number}
    return {
        "reference": str(entry.reference), "kind": entry.kind, "amount": str(entry.amount),
        "direction": "credit" if credit else "debit", "description": entry.description,
        "created_at": entry.created_at.isoformat(), "status": "Completed", "counterparty": counterparty,
    }
