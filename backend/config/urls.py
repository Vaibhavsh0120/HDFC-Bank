from django.contrib import admin
from django.urls import path

from banking import customer, updates, views

admin.site.site_header = "HDFC Bank Operations"
admin.site.site_title = "HDFC Bank Operations"

urlpatterns = [
    path("admin/", admin.site.urls),
    path("health/", views.health),
    path("api/auth/register/", views.register),
    path("api/auth/login/", views.login),
    path("api/auth/google/config/", views.google_config),
    path("api/auth/google/", views.google_login),
    path("api/auth/logout/", views.logout),
    path('api/auth/password/reset/request/', customer.password_reset_request),
    path('api/auth/password/reset/confirm/', customer.password_reset_confirm),
    path('api/auth/password/change/', customer.password_change),
    path('api/auth/password/add/', customer.password_add),
    path('api/auth/google/link/', customer.google_link),
    path('api/auth/google/unlink/', customer.google_unlink),
    path('api/profile/', customer.profile),
    path('api/nominee/', customer.nominee),
    path('api/beneficiaries/', customer.beneficiaries),
    path('api/card/', customer.virtual_card),
    path('api/support/', customer.support),
    path('api/security/pin/reset/request/', customer.pin_reset_request),
    path('api/security/pin/reset/confirm/', customer.pin_reset_confirm),
    path("api/dashboard/", views.dashboard),
    path("api/security/pin/", views.transaction_pin),
    path("api/activity/updates/", updates.incoming_updates),
    path("api/recipient/", views.recipient),
    path("api/movements/", views.movement),
    path("api/history/", views.history),
]
