"""Local UI review only, with fictional data and emails written to artifacts."""
from .test_settings import *  # noqa: F403

DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': BASE_DIR / 'demo.sqlite3'}}
PASSWORD_HASHERS = ['django.contrib.auth.hashers.PBKDF2PasswordHasher']
EMAIL_BACKEND = 'django.core.mail.backends.filebased.EmailBackend'
EMAIL_FILE_PATH = BASE_DIR.parent / 'artifacts' / 'emails'
CORS_ALLOWED_ORIGINS = ['http://127.0.0.1:4321', 'http://localhost:4321', 'http://127.0.0.1:4322', 'http://localhost:4322']
