FROM python:3.12-slim AS build
ENV PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends build-essential pkg-config default-libmysqlclient-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY requirements.txt .
RUN pip wheel --wheel-dir /wheels -r requirements.txt

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends libmariadb3 ca-certificates curl && rm -rf /var/lib/apt/lists/* && useradd --create-home bank
COPY --from=build /wheels /wheels
RUN pip install --no-cache-dir /wheels/* && rm -rf /wheels
WORKDIR /app
COPY --chown=bank:bank . .
RUN mkdir -p /app/staticfiles && chown bank:bank /app/staticfiles
USER bank
EXPOSE 8000
CMD ["sh", "-c", "python manage.py collectstatic --noinput && python manage.py migrate --noinput && gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 1 --threads 2 --timeout 60"]
