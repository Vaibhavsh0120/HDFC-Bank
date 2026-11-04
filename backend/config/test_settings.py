"""Isolated tests: never load .env or connect to the hosted MySQL database."""
import os

os.environ['BANK_LOCAL_MYSQL'] = '1'
os.environ['DJANGO_DEBUG'] = '1'
os.environ['DJANGO_SECRET_KEY'] = 'isolated-tests-only'
os.environ['DB_HOST'] = '127.0.0.1'
os.environ['DB_USER'] = 'unused'
os.environ['DB_PASSWORD'] = 'unused'
from .settings import *  # noqa: F403,E402

DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}}
EMAIL_BACKEND = 'django.core.mail.backends.locmem.EmailBackend'
PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']
ALLOWED_HOSTS = ['testserver', 'localhost', '127.0.0.1']

