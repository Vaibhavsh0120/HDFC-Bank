<div align="center">
  <img src="frontend/public/social-card-v2.png" alt="HDFC Bank. Your savings, always in view." width="800" />

  # HDFC Bank

  **A clear view of your savings.**

  Manage an account, move funds and follow your activity across the web and mobile.

  [Open the website](https://hdfc-bank-web.onrender.com) · [Mobile releases](https://github.com/Vaibhavsh0120/HDFC-Bank/releases) · [Report an issue](https://github.com/Vaibhavsh0120/HDFC-Bank/issues)
</div>

---

> HDFC Bank is an independent student project. Accounts and funds are fictional, and this project is not affiliated with the real HDFC Bank.

## Your account at a glance

| | |
| --- | --- |
| **Personal account** | Register, sign in and receive a savings account with a unique account number. |
| **Everyday transactions** | Deposit, withdraw or transfer to another registered account after reviewing the details. |
| **Activity and statements** | Search and filter transactions, inspect receipts and open a mini-statement. |
| **Administration** | Review customers, accounts and transactions, and manage account status through Django admin. |

<img src="frontend/public/account-mobile.png" width="260" alt="Mobile account overview" />

## Contents

- [Local network setup](#local-network-setup)
- [Development setup](#development-setup)
- [Environment and encrypted backups](#environment-and-encrypted-backups)
- [Deployment](#deployment)
- [Mobile releases](#mobile-releases)
- [Testing](#testing)
- [Project structure](#project-structure)
- [How transactions work](#how-transactions-work)
- [Study guide for the college review](docs/PROJECT-STUDY-GUIDE.md)

## Local network setup

Use the local scripts for a Windows-hosted MySQL installation and devices connected to the same network. The local database and its accounts are separate from Aiven.

The local network address uses HTTP. Use it only on a trusted Wi-Fi network, and stop the services when you are finished.

### Requirements

- Python 3.12 and Node.js 22.23.4 or newer.
- A running local MySQL server. Its user needs permission to create and use the local database.
- Python dependencies in the project `.venv` and frontend dependencies installed with `npm ci`.
- A private network connection between the host and any other device. The host firewall must allow TCP ports **4321** and **8000** on that network.

Install the dependencies once from the project root in PowerShell.

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python -m pip install -r backend\requirements.txt
cd frontend
npm ci
cd ..
```

Start the application.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\local-run.ps1
```

The script prompts for the local MySQL password, applies migrations and prints the address to open on the host or another device on the same network. If the computer has several network adapters, provide its Wi-Fi IPv4 address.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\local-run.ps1 -LanAddress 192.168.1.10
```

To use different local MySQL settings, pass `-MySqlUser`, `-MySqlPort` or `-MySqlDatabase`. Use the stop script to stop the processes started by the application.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\local-stop.ps1
```

Sign up separate accounts on two devices and use the recipient's account number to transfer between them. Both devices must use the local website address shown by the script to share the local database.

The published mobile packages are configured for the hosted HTTPS API. To build an Android APK for this Wi-Fi network, install Android SDK build tools and JDK 21, then start with `-BuildAndroid`.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\local-run.ps1 -BuildAndroid
```

The script prints the APK path. Install it on an Android device connected to the same Wi-Fi. The local APK uses the selected host IP, so rebuild it if that address changes. Opening the local website in a phone browser also uses the local database. The iOS release package targets the hosted API.

## Development setup

Use the local scripts above for MySQL, or configure a local MySQL database manually as shown below.

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python -m pip install -r backend\requirements.txt
if (!(Test-Path backend\.env)) { Copy-Item backend\.env.example backend\.env }
if (!(Test-Path frontend\.env)) { Copy-Item frontend\.env.example frontend\.env }
$env:DJANGO_DEBUG = "1"
$env:BANK_LOCAL_MYSQL = "1"
$env:DB_HOST = "127.0.0.1"
$env:DB_PORT = "3306"
$env:DB_NAME = "hdfc_bank_local"
$env:DB_USER = "root"
$env:DB_PASSWORD = Read-Host "MySQL password"
$env:DJANGO_ALLOWED_HOSTS = "localhost,127.0.0.1"
$env:CORS_ORIGINS = "http://localhost:4321,http://127.0.0.1:4321"
.\.venv\Scripts\python backend\manage.py migrate
.\.venv\Scripts\python backend\manage.py runserver
```

In a second terminal, start Astro.

```powershell
cd frontend
npm ci
$env:PUBLIC_API_URL = "http://127.0.0.1:8000"
npm run dev
```

Open the local address printed by Astro. Create an administrator with `python backend/manage.py createsuperuser`, then visit `/admin/` on the Django server.

## Environment and encrypted backups

The two apps have their own environment files. Plaintext `.env` files are ignored by Git.

| File | Purpose |
| --- | --- |
| `backend/.env` | Django, allowed hosts and origins, database and optional TLS settings. |
| `frontend/.env` | The API origin and public iOS Google client ID embedded when the frontend is built. |
| `backend/.env.age` | Encrypted backend deployment settings. |
| `frontend/.env.age` | Encrypted frontend deployment settings. |

The backend deployment uses `DJANGO_SECRET_KEY`, `DJANGO_DEBUG`, `DJANGO_ALLOWED_HOSTS` and `CORS_ORIGINS`. MySQL uses `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` and the base64-encoded CA in `DB_SSL_CA_BASE64`. The encrypted backend backup also stores the Django administrator credentials. The frontend uses `PUBLIC_API_URL` at build time.

On the configured machine, run `ageu` inside the relevant app directory to decrypt its backup. Run `agel` there after updating its plaintext `.env`. Keep the age identity private and outside the repository.

For Google sign-in, set `GOOGLE_CLIENT_ID` on the backend to a Google web OAuth client ID and authorize the frontend HTTPS origin in Google Cloud. Set `PUBLIC_GOOGLE_IOS_CLIENT_ID` in the frontend environment for iOS builds; the release workflow accepts a repository variable of the same name. Register the Android package and SHA-1 of each signing certificate in the same Google Cloud project. Web sign-in requires a secure origin; plain HTTP LAN websites use password sign-in. Native Google sign-in requires internet access, and local debug APKs need a separate OAuth client for their debug signing certificate. Google identities are not automatically linked to existing password accounts because password registration does not verify email ownership.

**Restoring the encrypted backups gives the apps their hosted configuration.** Use the local scripts or the example files for local development, and take care not to run tests or migrations against the hosted database unintentionally.

## Deployment

The application has two independently deployed Render services and a persistent Aiven MySQL database.

| Service | Role |
| --- | --- |
| [Frontend](https://hdfc-bank-web.onrender.com) | Serves the Astro static build. |
| [API](https://hdfc-bank-api-mxm8.onrender.com/health/) | Runs Django and connects to MySQL. |
| Aiven MySQL | Stores accounts, sessions and transaction records independently of app deploys. |

The root `render.yaml` describes the services. Configure the backend's Django secret, allowed frontend origin, MySQL connection and `DB_SSL_CA_BASE64`. Configure `PUBLIC_API_URL` on the frontend to the API's HTTPS origin. Apply migrations and create a Django administrator for a new database.

Free hosting may take time to wake after inactivity. The interface reports connection errors so a request can be retried.

## Mobile releases

1. Set the GitHub repository variable `PUBLIC_API_URL` to the deployed HTTPS API origin.
2. Open **Actions → Mobile release → Run workflow**.
3. Choose Android, iOS or both, enter a new version such as `1.0.0`, and choose whether to publish.
4. Download successful artifacts from the workflow run or, when publishing is selected, from GitHub Releases.

Android APKs are signed using the project release key. Configure repository secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, and `ANDROID_KEY_ALIAS` before building. The encrypted recovery archive is stored locally at `D:/Dev/Secrets/age/hdfc-bank-release.credentials.age`. Keep it and the age identity safe. The v1.0.0 APK used a different debug key, so it must be uninstalled before installing a release signed with the project key.

The iOS IPA is unsigned and needs Apple signing and provisioning before it can be installed. A release is published only when every selected build succeeds; an existing release version is not overwritten.

## Testing

For local MySQL testing, use a local account with permission to create a separate test database.

```powershell
$env:DJANGO_DEBUG = "1"
$env:BANK_LOCAL_MYSQL = "1"
$env:DB_HOST = "127.0.0.1"
$env:DB_PORT = "3306"
$env:DB_NAME = "hdfc_bank_local"
$env:DB_USER = "root"
$env:DB_PASSWORD = Read-Host "MySQL password"
.\.venv\Scripts\python backend\manage.py test banking
cd frontend
npm run check
npm run build
```

The Django suite covers authentication, transaction validation, retries, account isolation, administration and statements. MySQL-specific concurrency tests need a separate test database and sufficient permissions to create it.

## Project structure

```text
backend/            Django settings, REST endpoints, services and tests
frontend/           Astro, React, assets and Capacitor configuration
docs/               Project study guide and backend walkthrough
scripts/            Windows local network start and stop scripts
.github/workflows/  Manual mobile release workflow
render.yaml         Render service configuration
```

## How transactions work

Balance changes and their ledger entry commit together. Transfers acquire account locks in a consistent order. A request identifier makes a repeated confirmation return the original entry. If the response is interrupted, the interface retains the request on that device so it can be checked again.

The mini-statement merges ordered account activity and retains the latest entries in a bounded circular buffer.

## Implementation notes

- Local MySQL uses an explicit loopback-only mode so hosted TLS settings cannot leak into a local connection. Hosted MySQL verifies the Aiven certificate.
- Incoming transfers are checked while the account is open, and transaction identifiers let a customer safely retry an interrupted confirmation.
- Transfers and withdrawals require a transaction PIN. Incorrect attempts are locked temporarily.
- Account QR codes contain an internal account number. Scanning fills the transfer form, and the recipient is confirmed before a transfer is submitted.
- The local network scripts serve a built frontend separately from development servers. This avoids conflicts when another Astro process is running.

The team must maintain its own contribution history and pull-request reviews. See Django's user and group administration for built-in many-to-many role relationships.

---

<div align="center"><sub>Built for learning and technical discussion.</sub></div>
