from django.contrib import admin

from .models import Account, Entry


@admin.register(Account)
class AccountAdmin(admin.ModelAdmin):
    list_display = ("number", "owner", "balance", "status", "created_at")
    list_filter = ("status",)
    search_fields = ("owner__username", "owner__first_name")
    readonly_fields = ("number", "owner", "balance", "created_at")
    list_select_related = ('owner',)

    def save_model(self, request, obj, form, change):
        obj.save(update_fields=['status'])

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(Entry)
class EntryAdmin(admin.ModelAdmin):
    list_display = ("reference", "kind", "amount", "initiator", "recipient", "created_at")
    list_filter = ("kind", "created_at")
    search_fields = ("reference", "description")
    list_select_related = ("initiator", "recipient")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
