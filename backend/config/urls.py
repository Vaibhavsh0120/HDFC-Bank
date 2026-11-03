from django.contrib import admin
from django.urls import path

from banking import views

admin.site.site_header = "HDFC Bank Operations"
admin.site.site_title = "HDFC Bank Operations"

urlpatterns = [
    path("admin/", admin.site.urls),
    path("health/", views.health),
    path("api/auth/register/", views.register),
    path("api/auth/login/", views.login),
    path("api/auth/logout/", views.logout),
    path("api/dashboard/", views.dashboard),
    path("api/recipient/", views.recipient),
    path("api/movements/", views.movement),
    path("api/history/", views.history),
]
