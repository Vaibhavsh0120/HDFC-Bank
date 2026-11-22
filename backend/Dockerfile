FROM python:3.12-alpine3.24 AS build
ENV PIP_NO_CACHE_DIR=1
RUN apk upgrade --no-cache && apk add --no-cache build-base pkgconf mariadb-connector-c-dev
WORKDIR /build
COPY requirements.txt .
RUN pip wheel --wheel-dir /wheels -r requirements.txt

FROM python:3.12-alpine3.24
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN apk upgrade --no-cache && apk add --no-cache mariadb-connector-c ca-certificates && adduser -D bank
COPY --from=build /wheels /wheels
RUN pip install --no-cache-dir /wheels/* && rm -rf /wheels
WORKDIR /app
COPY --chown=bank:bank . .
RUN mkdir -p /app/staticfiles && chown bank:bank /app/staticfiles
RUN BANK_LOCAL_MYSQL=1 DJANGO_DEBUG=1 DB_HOST=127.0.0.1 DB_USER=build DB_PASSWORD=unused python manage.py collectstatic --noinput
USER bank
EXPOSE 8000
CMD ["sh", "-c", "python manage.py migrate --noinput && gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 1 --threads 2 --timeout 60"]
