from datetime import timedelta

from django.contrib.auth.hashers import check_password, make_password
from django.db import transaction
from django.utils import timezone

from .models import Account

MAX_ATTEMPTS = 5
LOCK_DURATION = timedelta(minutes=15)


def pin_status(account):
    locked_until = account.pin_locked_until
    if locked_until and locked_until <= timezone.now():
        locked_until = None
    return {
        "configured": bool(account.pin_hash),
        "locked_until": locked_until.isoformat() if locked_until else None,
    }


@transaction.atomic
def set_pin(account_id, pin):
    account = Account.objects.select_for_update().get(pk=account_id)
    if account.pin_hash:
        return False
    account.pin_hash = make_password(pin)
    account.save(update_fields=["pin_hash"])
    return True


@transaction.atomic
def verify_pin(account_id, pin, *, new_pin=None):
    """Persist failed attempts before returning the outcome to the caller."""
    account = Account.objects.select_for_update().get(pk=account_id)
    now = timezone.now()
    if not account.pin_hash:
        return "not_configured"
    if account.pin_locked_until and account.pin_locked_until > now:
        return "locked"
    if account.pin_locked_until:
        account.pin_failures = 0
        account.pin_locked_until = None
    if check_password(pin, account.pin_hash):
        account.pin_failures = 0
        account.pin_locked_until = None
        fields = ["pin_failures", "pin_locked_until"]
        if new_pin is not None:
            account.pin_hash = make_password(new_pin)
            fields.append("pin_hash")
        account.save(update_fields=fields)
        return "ok"
    account.pin_failures += 1
    if account.pin_failures >= MAX_ATTEMPTS:
        account.pin_locked_until = now + LOCK_DURATION
    account.save(update_fields=["pin_failures", "pin_locked_until"])
    return "locked" if account.pin_locked_until else "incorrect"
