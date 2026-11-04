# Setup and operations

For the quickest isolated preview, start with the [README](../README.md#run-a-local-demo). This guide covers MySQL, local devices, hosted configuration and mobile packaging.

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
.\.venv\Scripts\python -m pip install -r backend\requirements-dev.txt
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
.\.venv\Scripts\python -m pip install -r backend\requirements-dev.txt
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

The `.env.age` files require the maintainer’s private age identity. They are optional backups, not prerequisites for running the project. Use the standard age CLI to decrypt only when restoring hosted configuration; machine-specific `ageu` / `agel` helpers are not required. Keep the identity outside the repository. Start local development with the example files or the isolated demo settings instead.

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
3. Choose Android, iOS or both, enter a new version (the current release uses `1.6.2`), and choose whether to publish.
4. Download successful artifacts from the workflow run or, when publishing is selected, from GitHub Releases.

Android APKs are signed using the project release key. Configure repository secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, and `ANDROID_KEY_ALIAS` before building. Keep a private age-encrypted recovery archive outside the repository. Keep it and the age identity safe. The v1.0.0 APK used a different debug key, so it must be uninstalled before installing a release signed with the project key.

The iOS IPA is unsigned and needs a compatible signing or LiveContainer setup. A release is published only when every selected build succeeds; an existing release version is not overwritten. Authored version notes come from [CHANGELOG.md](../CHANGELOG.md). If a future version has no authored section, GitHub generates commit notes and the workflow appends installation details.

### LiveContainer source updates

Add [this stable source URL](https://raw.githubusercontent.com/Vaibhavsh0120/HDFC-Bank/main/apps.json) in LiveContainer's source manager. The catalog includes only published, non-prerelease versions with a non-empty iOS IPA asset. Versions are sorted numerically; Android-only releases do not replace the latest iOS entry.

After a successful manual iOS/combined publication, the mobile workflow calls `livecontainer-source.yml` explicitly. This works even though releases created using `GITHUB_TOKEN` do not trigger another release-event workflow. The source workflow also supports manual refreshes. It writes only `apps.json` on `main` using `contents: write`; this small automated commit keeps the repository on a single branch. The workflow explicitly checks out `main` to use the current source generator. Concurrent source updates are serialized. After editing or deleting an existing release outside the mobile workflow, run **Update LiveContainer source** to refresh its catalog.

For maintainers, `python scripts/release_tools.py source --output artifacts/apps.json` previews the catalog. Add `--publish` with `GH_TOKEN` to update it. `backfill --publish` updates existing GitHub release bodies from CHANGELOG; `--git-credentials` can use the configured local Git credential helper without writing credentials to disk. Catalog refreshes do not silently install updates in a user's container.

### Native device unlock

The first authenticated app session offers **Enable device unlock** and **Not now** only after its dashboard request succeeds. Restoring a token does not itself show setup. The app validates saved sessions before mounting native authentication; expired sessions return to sign-in and network failures show retry/recovery controls. **Settings → Security → Device unlock** enables or disables it later. Enabling and disabling an existing lock require OS authentication. Device credentials are permitted as the biometric fallback; there is no new login PIN. Logout, expiry and sign-in recovery remove the saved token before storing a disabled preference, so later logins do not repeatedly show first-time setup. The website does not expose this feature. Transaction PINs continue protecting payments and card writes.

Native session tokens and the unlock preference use local Keychain/encrypted native storage through `@aparajita/capacitor-secure-storage`. Existing native local-storage sessions migrate to that store. Keychain sync is disabled; iOS uses device-only accessibility. Website tokens remain in browser storage. Device unlock gates the local interface and is not a replacement for server token validation or transaction authorization.

An enabled session requires authentication on cold launch. Backgrounding removes the account interface and returning shows the locked screen; **Unlock app** retries authentication. Cancellation never opens the dashboard. Since 1.5.1, OS authentication success opens the account without waiting for an immediate active-state result, which can remain stale in iOS containers. Face ID's transient iOS inactive event does not relock the app; the actual background/pause event does, and a late result from an interrupted attempt cannot unlock it. Android's authentication activity pause is ignored while its prompt is in progress. **Sign in again** clears the saved local session and disables device unlock so account credentials can establish a fresh session. A phone without a screen lock must configure one before enabling device unlock. The native generator adds the iOS `NSFaceIDUsageDescription`; Android biometric permissions are merged from the biometric library. Test the actual Face ID/fingerprint/passcode fallback, backgrounding and keychain persistence on the target phone and LiveContainer version.

## Testing

Run the isolated SQLite suite without loading hosted database credentials:

```powershell
.\.venv\Scripts\python backend\manage.py test banking --settings=config.test_settings
```

SQLite skips the two InnoDB concurrency tests. The release review also ran the full suite against a separate MySQL 8.0 instance. See [the release review](RELEASE-REVIEW.md) for current evidence and [the customer-flow audit](CUSTOMER-FLOW-AUDIT.md) for device limitations.

For the complete suite, use a **dedicated local MySQL test server/user** with permission to create and drop a test database. These settings ignore both `.env` files, reject non-loopback hosts, and use fast test-only password hashes. Never point tests at a database you need to keep. Django creates and destroys `test_bank_review` (override with `MYSQL_TEST_DATABASE`, which must start with `test_`).

```powershell
$env:MYSQL_TEST_USER = "bank_test"
$env:MYSQL_TEST_PASSWORD = Read-Host "Local test database password"
$env:MYSQL_TEST_PORT = "3306"
.\.venv\Scripts\python backend\manage.py test banking --settings=config.mysql_test_settings --noinput
```

The ordinary local app uses production password hashing and MySQL rules; the isolated SQLite demo is for sequential UI walkthroughs, not concurrency testing.

```powershell
.\.venv\Scripts\python backend\manage.py check --settings=config.test_settings
.\.venv\Scripts\python backend\manage.py makemigrations --check --dry-run --settings=config.test_settings
cd frontend
npm run check
npm test
npm run build
npm audit
```

`Verify project` runs the full MySQL suite, schema checks, dependency audits, frontend checking and build on GitHub pushes and pull requests. The mobile workflow calls it before packaging. Hosted Actions execution still depends on the repository/account being allowed to run Actions. Browser checks remain a separate local step; see [the smoke-test instructions](CUSTOMER-FLOW-AUDIT.md#reproducing-the-browser-check).

The Django suite covers authentication, transaction validation, retries, account isolation, administration and statements. MySQL-specific concurrency tests need a separate test database and sufficient permissions to create it.
The development requirements include Django and REST Framework type stubs so VS Code can analyze the backend. Select the project `.venv` interpreter in VS Code if it retains an older interpreter selection.

## Implementation notes

### Recovery emails

Password and PIN reset codes expire after 10 minutes, allow at most five wrong attempts, and can be used once. Resends have a 60-second cooldown. Codes are hashed in the database and never returned in API responses. Password recovery invalidates all prior logins. A password change keeps the current login, revokes other bearer sessions, and cancels outstanding password-reset codes.

For existing SMTP configuration, set `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `DEFAULT_FROM_EMAIL`, and the matching TLS/SSL options. The SMTP backend is selected automatically when `EMAIL_HOST` is present. Set only one of `EMAIL_USE_TLS` or `EMAIL_USE_SSL` to `1`.

Render free services block standard SMTP ports. The deployed project uses Brevo Free (300 emails/day): set `BREVO_API_KEY` and a verified `DEFAULT_FROM_EMAIL`; the HTTPS backend is selected automatically. Complete Brevo phone/sender verification and create a key restricted to transactional email. `RESEND_API_KEY` remains an alternative for deployments with a verified sending domain. See [Render's free-service limits](https://render.com/docs/free) and [Resend's sending API](https://resend.com/docs/api-reference/emails/send-email). Plaintext email credentials are excluded from source control. Keep `.env.example` free of secrets, update the Render API environment separately, and run `agel` from `backend/` to refresh the encrypted `.env.age` backup. A new deployment is required after changing hosting configuration. Without a sender, production recovery reports that email delivery is unavailable.

Both PIN and password recovery send styled HTML plus plain text. The centered title, contiguous six-digit code and explicit verification-code subject help email clients recognize the code. The reset forms use `autocomplete="one-time-code"`. Gmail copy-code cards and OS autofill are controlled by the email client/OS and are not guaranteed; the app does not read the user's mailbox.

Local development defaults to console emails. The isolated UI-review settings write emails under ignored `artifacts/emails/` instead of sending them. Neither local test mode proves inbox delivery.

### Sign-in methods

Open **Settings > Security > Sign-in methods**. Password users can confirm their password and select Google to link it explicitly. Google-only users can add a password after confirming the same linked Google identity. Users with both methods can confirm their password to unlink Google. The server prevents unlinking the last method, serializes changes under the user lock and rejects identities belonging to another account. Google verification remains on the server; email matching alone never links accounts. Unlinking Google or adding/changing a password keeps the current session and revokes other sessions. The contact email is the email/password sign-in ID.

### Account services

Nominee records belong to the signed-in account, require a PIN to change, and require guardian details for minors. These project records do not create a legal bank nomination. Virtual cards store a random 16-digit, checksum-valid demo number, CVV, selected network and issue date. VISA, RuPay and Mastercard use corresponding numeric formats, without issuing real payment cards. PIN-protected replacement changes the number/CVV, restarts the three-year expiry and preserves the freeze state. Creation retries return the existing card. Migration `0006` assigns numeric details to existing demo cards while retaining their creation dates and freeze states. These cards cannot be used with merchants, ATMs or external card networks. Phone and email edits do not claim that contact details have been verified.

The iOS shell includes safe-area spacing and a portrait fallback for embedded containers that report zero top inset. Android uses the native QR scanner, with image upload and account-number entry as alternatives. Browser camera scanning needs HTTPS or localhost; an HTTP LAN page can still upload a QR image.

- Local MySQL uses an explicit loopback-only mode so hosted TLS settings cannot leak into a local connection. Hosted MySQL verifies the Aiven certificate.
- Incoming transfers are checked while the account is open, and transaction identifiers let a customer safely retry an interrupted confirmation.
- Transfers and withdrawals require a transaction PIN. Incorrect attempts are locked temporarily.
- Account QR codes contain an internal account number. Scanning fills the transfer form, and the recipient is confirmed before a transfer is submitted.
- The local network scripts serve a built frontend separately from development servers. This avoids conflicts when another Astro process is running.

The team must maintain its own contribution history and pull-request reviews. See Django's user and group administration for built-in many-to-many role relationships.

### Incoming payment notifications (1.6.2)

While the account is open, incoming payments are checked every second (every 15 seconds while the page is hidden). Focus, visibility and network reconnection request an immediate check. The dashboard supplies the first cursor, and the current tab remembers progress across reloads and app-lock remounts. Failed requests retain the cursor. These are in-app alerts, not operating-system push notifications for a closed app.

On the receive-QR screen, a verified incoming transfer flips the QR into a card showing the credited amount and sender. It flips back after three seconds or a tap. Other screens keep the existing banner. Incoming-alert preferences apply to both; reduced-motion settings disable the rotation. The manual release now reserves its version tag before the long builds, while builds still require passing verification, so a later push does not force the publication job to create a tag on older workflow source.
