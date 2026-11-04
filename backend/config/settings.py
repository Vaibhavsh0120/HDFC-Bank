import os
import base64
import tempfile
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
LOCAL_MYSQL = os.getenv("BANK_LOCAL_MYSQL") == "1"
if not LOCAL_MYSQL:
    load_dotenv(BASE_DIR / ".env")


def csv(name, default=""):
    return [item.strip() for item in os.getenv(name, default).split(",") if item.strip()]


DEBUG = os.getenv("DJANGO_DEBUG", "0" if os.getenv("RENDER") else "1") == "1"
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
SECRET_KEY = os.getenv("DJANGO_SECRET_KEY") or (
    "django-insecure-local-development-key-never-use-in-production" if DEBUG else ""
)
if not SECRET_KEY:
    raise ImproperlyConfigured("Set DJANGO_SECRET_KEY for production.")

ALLOWED_HOSTS = csv("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,[::1]")
if render_host := os.getenv("RENDER_EXTERNAL_HOSTNAME"):
    ALLOWED_HOSTS.append(render_host)

INSTALLED_APPS = [
    "django.contrib.admin", "django.contrib.auth", "django.contrib.contenttypes",
    "django.contrib.sessions", "django.contrib.messages", "django.contrib.staticfiles",
    "corsheaders", "rest_framework", "banking",
]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "banking.middleware.ApiNoStoreMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "APP_DIRS": True,
    "OPTIONS": {"context_processors": [
        "django.template.context_processors.request",
        "django.contrib.auth.context_processors.auth",
        "django.contrib.messages.context_processors.messages",
    ]},
}]

if host := os.getenv("DB_HOST"):
    options = {"init_command": "SET sql_mode='STRICT_TRANS_TABLES'", "connect_timeout": 5}
    if LOCAL_MYSQL and host not in ("127.0.0.1", "localhost", "::1"):
        raise ImproperlyConfigured("BANK_LOCAL_MYSQL requires a loopback database host.")
    ca = None if LOCAL_MYSQL else os.getenv("DB_SSL_CA")
    if certificate := (None if LOCAL_MYSQL else os.getenv("DB_SSL_CA_BASE64")):
        with tempfile.NamedTemporaryFile(prefix="bank-ca-", suffix=".pem", delete=False) as ca_file:
            ca_file.write(base64.b64decode(certificate, validate=True))
            ca = ca_file.name
    if not DEBUG and not ca:
        raise ImproperlyConfigured("Set DB_SSL_CA to the MySQL CA certificate path.")
    if ca:
        options.update(ssl={"ca": ca}, ssl_mode="VERIFY_IDENTITY")
    elif LOCAL_MYSQL:
        options["ssl_mode"] = "DISABLED"
    DATABASES = {"default": {
        "ENGINE": "django.db.backends.mysql", "HOST": host,
        "PORT": os.getenv("DB_PORT", "3306"), "NAME": os.getenv("DB_NAME", "bank"),
        "USER": os.environ["DB_USER"], "PASSWORD": os.environ["DB_PASSWORD"],
        "OPTIONS": options, "CONN_MAX_AGE": 60, "CONN_HEALTH_CHECKS": True,
    }}
else:
    raise ImproperlyConfigured("Set DB_HOST for the MySQL database.")

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": f"django.contrib.auth.password_validation.{validator}"}
    for validator in (
        "UserAttributeSimilarityValidator", "MinimumLengthValidator",
        "CommonPasswordValidator", "NumericPasswordValidator",
    )
]
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
TIME_ZONE = "Asia/Kolkata"
USE_TZ = True
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}
CORS_URLS_REGEX = r"^/api/"
CORS_ALLOWED_ORIGINS = csv(
    "CORS_ORIGINS",
    "http://localhost:4321,http://127.0.0.1:4321" if DEBUG else "",
) + ["https://localhost", "capacitor://localhost"]

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https") if os.getenv("RENDER") else None
SECURE_SSL_REDIRECT = not DEBUG
SECURE_REDIRECT_EXEMPT = [r"^health/$"]
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
SECURE_HSTS_SECONDS = 31536000 if not DEBUG else 0

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["banking.authentication.BankingAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_THROTTLE_RATES": {"access": "12/min", "recipient": "30/min"},
    "NUM_PROXIES": 1 if os.getenv("RENDER") else 0,
}
