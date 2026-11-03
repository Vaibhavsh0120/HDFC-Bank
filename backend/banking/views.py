from django.contrib.auth import authenticate
from django.db import IntegrityError, connection, transaction
from django.db.models import Q
from django.http import JsonResponse
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from .authentication import issue_token
from .models import Account, Entry
from .serializers import InstructionSerializer, LoginSerializer, RegistrationSerializer, User, account_data, entry_data
from .services import BankingError, Instruction, account_id, mini_statement, post_entry, recipient_for


class AccessThrottle(ScopedRateThrottle):
    def allow_request(self, request, view):
        view.throttle_scope = "access"
        return super().allow_request(request, view)


class RecipientThrottle(ScopedRateThrottle):
    def allow_request(self, request, view):
        view.throttle_scope = "recipient"
        return super().allow_request(request, view)


def session_response(user, status=200):
    response = Response({"token": issue_token(user), "account": account_data(user.account)}, status=status)
    response["Cache-Control"] = "no-store"
    return response


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([AccessThrottle])
def register(request):
    serializer = RegistrationSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    with transaction.atomic():
        try:
            with transaction.atomic():
                user = User.objects.create_user(
                    username=data["email"], email=data["email"],
                    password=data["password"], first_name=data["name"],
                )
        except IntegrityError:
            if User.objects.filter(username=data["email"]).exists():
                return Response({"detail": "An account already uses this email address."}, status=409)
            raise
        Account.objects.create(owner=user)
        return session_response(user, 201)


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([AccessThrottle])
def login(request):
    serializer = LoginSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    user = authenticate(request, username=data["email"].lower(), password=data["password"])
    if user is None or not Account.objects.filter(owner=user).exists():
        return Response({"detail": "Check your email address and password."}, status=401)
    return session_response(user)


@api_view(["POST"])
def logout(request):
    request.auth.delete()
    return Response(status=204)


def own_account(request):
    return Account.objects.select_related("owner").get(owner=request.user)


@api_view(["GET"])
def dashboard(request):
    account = own_account(request)
    return Response({
        "account": account_data(account),
        "recent": [entry_data(entry, account.pk) for entry in mini_statement(account)],
    })


@api_view(["POST"])
@throttle_classes([RecipientThrottle])
def recipient(request):
    try:
        target = recipient_for(own_account(request).pk, str(request.data.get("number", "")))
    except BankingError as exc:
        return Response({"detail": str(exc)}, status=exc.status)
    return Response({"name": target.owner.first_name, "number": target.number})


@api_view(["POST"])
def movement(request):
    serializer = InstructionSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data.copy()
    number = data.pop("recipient", None)
    source = own_account(request)
    try:
        entry, created = post_entry(source.pk, Instruction(
            **data, recipient_id=account_id(number) if number else None,
        ))
    except BankingError as exc:
        return Response({"detail": str(exc)}, status=exc.status)
    source.refresh_from_db(fields=["balance", "status"])
    return Response(
        {"entry": entry_data(entry, source.pk), "account": account_data(source)},
        status=201 if created else 200,
    )


@api_view(["GET"])
def history(request):
    account = own_account(request)
    entries = Entry.objects.filter(Q(initiator=account) | Q(recipient=account)).select_related(
        "initiator__owner", "recipient__owner",
    )
    kind = request.query_params.get("kind", "")
    if kind:
        if kind not in Entry.Kind.values:
            return Response({"detail": "Unknown transaction type."}, status=400)
        entries = entries.filter(kind=kind)
    query = request.query_params.get("q", "").strip()[:140]
    if query:
        search = (
            Q(description__icontains=query) | Q(reference__icontains=query.replace("-", ""))
            | Q(initiator__owner__first_name__icontains=query, recipient=account)
            | Q(recipient__owner__first_name__icontains=query, initiator=account)
        )
        try:
            counterparty = account_id(query)
        except BankingError:
            pass
        else:
            search |= Q(initiator_id=counterparty, recipient=account) | Q(recipient_id=counterparty, initiator=account)
        entries = entries.filter(search)
    paginator = PageNumberPagination()
    paginator.page_size = 15
    rows = paginator.paginate_queryset(entries, request)
    return paginator.get_paginated_response([entry_data(entry, account.pk) for entry in rows])


def health(request):
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1")
    return JsonResponse({"status": "ok"})
