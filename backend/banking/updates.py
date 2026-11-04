from django.db.models import Max
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import Account, Entry
from .serializers import account_data, entry_data


@api_view(["GET"])
def incoming_updates(request):
    account = Account.objects.select_related("owner").get(owner=request.user)
    incoming = Entry.objects.filter(recipient=account, kind=Entry.Kind.TRANSFER)
    after = request.query_params.get("after")
    if after is None:
        cursor = incoming.aggregate(value=Max("pk"))["value"] or 0
        return Response({"cursor": cursor, "entries": [], "account": account_data(account)})
    if not after.isascii() or not after.isdecimal() or len(after) > 19:
        return Response({"detail": "Invalid activity cursor."}, status=400)
    cursor = int(after)
    if cursor > 9223372036854775807:
        return Response({"detail": "Invalid activity cursor."}, status=400)
    entries = list(incoming.filter(pk__gt=cursor).select_related(
        "initiator__owner", "recipient__owner",
    ).order_by("pk")[:50])
    if entries:
        cursor = entries[-1].pk
        account.refresh_from_db(fields=["balance", "status"])
    return Response({
        "cursor": cursor,
        "entries": [entry_data(entry, account.pk) for entry in entries],
        "account": account_data(account),
    })
