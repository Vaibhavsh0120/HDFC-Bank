"""Isolated InnoDB tests. Never load .env or use the hosted database."""
import os
import re

from django.core.exceptions import ImproperlyConfigured

from .test_settings import *  # noqa: F403

host = os.getenv('MYSQL_TEST_HOST', '127.0.0.1')
name = os.getenv('MYSQL_TEST_DATABASE', 'test_bank_review')
if host not in ('127.0.0.1', 'localhost', '::1'):
    raise ImproperlyConfigured('MySQL tests require a loopback host.')
if not re.fullmatch(r'test_[A-Za-z0-9_]{1,59}', name):
    raise ImproperlyConfigured('MYSQL_TEST_DATABASE must start with test_ and use letters, digits or underscores.')

DATABASES = {'default': {
    'ENGINE': 'django.db.backends.mysql',
    'HOST': host,
    'PORT': os.getenv('MYSQL_TEST_PORT', '3306'),
    'NAME': 'bank_review',
    'USER': os.getenv('MYSQL_TEST_USER', 'bank_test'),
    'PASSWORD': os.getenv('MYSQL_TEST_PASSWORD', ''),
    'OPTIONS': {'init_command': "SET sql_mode='STRICT_TRANS_TABLES'", 'connect_timeout': 5},
    'TEST': {'NAME': name},
}}
