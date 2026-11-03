<div align="center">

<img src="frontend/public/social-card.png" width="800" alt="HDFC Bank — Your savings. Always in view." />

# HDFC Bank

**A clear view of your savings.**

Personal banking built with Django, Astro and React.

[Open the website](https://hdfc-bank-web.onrender.com) · [Mobile releases](https://github.com/Vaibhavsh0120/HDFC-Bank/releases) · [Report an issue](https://github.com/Vaibhavsh0120/HDFC-Bank/issues)

</div>

---

## What you can do

- Open a savings account and sign in securely.
- Deposit or withdraw funds with a review step and receipt.
- Transfer between registered accounts and check the recipient before confirming.
- Search and filter transaction history, view a mini-statement and inspect references.
- Manage account status and review transactions through Django administration.

Accounts and funds are fictional. This independent student project has no affiliation with the real HDFC Bank.

## Built with

| Layer | Technology |
| --- | --- |
| Interface | Astro, React, TypeScript, Tailwind CSS |
| API | Python, Django, Django REST Framework |
| Data | MySQL on Aiven |
| Hosting | Render static site and web service |
| Mobile | Capacitor, Android and iOS |
| Delivery | GitHub Actions and GitHub Releases |

## Get started locally

1. Create and activate a Python 3.12 virtual environment.
2. Install the API dependencies and start Django.

   ```sh
   pip install -r backend/requirements.txt
   python backend/manage.py migrate
   python backend/manage.py runserver
   ```

3. In another terminal, start the frontend.

   ```sh
   cd frontend
   npm ci
   npm run dev
   ```

Open the local address printed by Astro. A fresh setup uses SQLite and the local API by default. Copy the example environment file in each app directory to `.env`. The encrypted deployment backups contain production settings, so restoring them connects to the hosted services.

## Testing

```sh
python backend/manage.py test banking
cd frontend
npm run check
npm run build
```

The API tests cover authentication, transaction validation, balance consistency, retries, account isolation, administration and statements. The concurrency test requires MySQL.

## Deployment

`render.yaml` defines a static frontend and a Django web service. Provide the API with the Django secret, allowed frontend origin, Aiven connection values and CA certificate. Set `PUBLIC_API_URL` on the static site to the API's HTTPS origin. Create a Django superuser to access `/admin/`.

For local MySQL, `docker compose up -d` starts the database in `compose.yaml`. Set the corresponding connection settings in `backend/.env`.

## Mobile builds

In GitHub, open **Actions → Mobile release → Run workflow**. Choose Android, iOS or both, enter a version such as `1.0.0`, and choose whether to publish a release. The workflow uses the `PUBLIC_API_URL` repository variable.

The Android APK is debug-signed. The iOS IPA is unsigned and requires Apple signing and provisioning before installation. Build artifacts are also available from the workflow run.

## Encrypted environment

The repository contains `backend/.env.age` and `frontend/.env.age`, encrypted with the configured age recipient. Run `ageu` inside the relevant app directory to restore its `.env`, and `agel` there after updating it. The backend backup holds the database connection, certificate, Django secret and admin credentials. The frontend backup holds the hosted API origin. Keep the age identity private and outside Git.

## How transactions stay consistent

Django commits balance changes and the transaction record together. Transfers lock accounts in a consistent order, and request identifiers allow a retry to return the original result. The mini-statement uses a bounded circular buffer and a merge of ordered account activity streams.

---

<div align="center"><sub>Built for learning and technical discussion.</sub></div>
