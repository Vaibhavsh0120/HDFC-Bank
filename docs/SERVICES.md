# Services and their purpose

The deployed project uses the services below. Hosting, database and recovery email are configured on free plans. No paid plan, payment-card purchase, custom domain or SMTP add-on is required for the current setup. Free quotas and provider policies still apply; exceeding them can delay builds, stop email delivery or require waiting for a reset. Do not enable paid upgrades or automatic credit purchases to solve a quota limit.

| Service | What it does | Configuration and cost boundary |
| --- | --- | --- |
| [Render frontend](https://hdfc-bank-web.onrender.com) | Serves the built Astro/React website over HTTPS. | Static site; builds `frontend/`. Its public API URL points to the separate API service. |
| [Render API](https://hdfc-bank-api-mxm8.onrender.com/health/) | Runs Django, validates logins, handles account settings, recovery codes and banking operations. | Free web service. Deploys from `main`; applies migrations before starting Gunicorn. Free instances can sleep when idle. |
| [Aiven MySQL](https://console.aiven.io/) | Stores users, accounts, sessions, hashed recovery challenges and the transaction ledger persistently. | Current service plan: `free-1-1gb` ($0). `DB_*` variables and a TLS CA connect only the backend to it. Local demos use a separate SQLite database. |
| [Google Identity](https://console.cloud.google.com/apis/credentials) | Lets users sign in with Google and explicitly link Google to an existing account. | OAuth client IDs identify the web, Android and iOS clients. The backend verifies Google ID tokens; it does not read Gmail. Password sign-in remains available independently. |
| [Brevo](https://app.brevo.com/) | Delivers password-reset and transaction-PIN-reset codes using its HTTPS transactional-email API. | Free allowance: 300 emails per day, shared with any other use of this Brevo account. A verified sender and phone are required. `BREVO_API_KEY` stays on the backend; `DEFAULT_FROM_EMAIL` selects the sender. |
| [GitHub repository](https://github.com/Vaibhavsh0120/HDFC-Bank) | Stores source code, documentation and the encrypted environment backup. | Plaintext `.env` files, local databases and test artifacts are ignored. Encrypted `.env.age` can be tracked; its private decryption identity must stay outside the repository. |
| [GitHub Actions and Releases](https://github.com/Vaibhavsh0120/HDFC-Bank/actions/workflows/mobile-release.yml) | Checks the web/API code, builds signed Android APKs and unsigned iOS IPAs, and publishes version-specific release notes and assets. | The public repository uses GitHub-hosted runners. Manual **Mobile release** publishes a selected version. Provider build and storage limits apply. |
| [LiveContainer catalog](https://raw.githubusercontent.com/Vaibhavsh0120/HDFC-Bank/main/apps.json) | Lists published iOS packages and release notes for the phone's source manager. | A GitHub Actions job updates `apps.json` on `main` after an iOS/combined release. Refresh the source on the phone; it does not silently install an update. |
| Phone operating system | Shows Face ID, fingerprint or device-password authentication and protects the saved native session. | Native app only, through Capacitor plugins. Biometric data stays with the operating system; this project stores no face or fingerprint data. No extra login PIN is created. |
| Local `age` / PowerShell `agel` | Encrypts the backend environment for a recoverable backup. | Free local tool. Run `agel` from `backend/` after changing `.env`; the function uses `AGE_PUBLIC_KEY` to overwrite `.env.age`. |

## Why recovery email uses HTTPS

[Render free web services block outbound SMTP ports 25, 465 and 587](https://render.com/docs/free#other-limitations). A Gmail app password authenticates an SMTP connection; it cannot remove that network restriction. The current deployment sends through [Brevo's HTTPS endpoint](https://developers.brevo.com/reference/send-transac-email), so it works without upgrading Render or using the Gmail app password.

A verified Gmail sender can be used without buying a domain. Brevo may rewrite its delivery address to a `brevosend.com` address for authentication compliance. The display name still identifies the student project. [Brevo explains its sender requirements here](https://help.brevo.com/hc/en-us/articles/14925263522578).

Reset emails contain a styled HTML message and a plain-text alternative. The title is centered, the code is prominent, and the email explains its 10-minute expiry and one-use limit. Codes are hashed in MySQL and never included in API responses. Delivery failures and exhausted quotas return a retryable error rather than claiming that a code was sent.

## Environment ownership

| Location | Contains |
| --- | --- |
| `backend/.env` and Render API environment | Database credentials, Django secret, Google web client ID, Brevo key and sender. |
| `backend/.env.example` | Variable names, safe placeholders and setup hints; no real keys. |
| `backend/.env.age` | Encrypted copy of the local backend environment. Updating it does not change Render settings automatically. |
| `frontend/.env` and frontend build settings | Public API origin and public Google client IDs. Never add the Brevo key, database password or Django secret here. |
| GitHub repository variables/secrets | Build configuration and Android signing credentials used by the release workflows. |

The optional Resend and SMTP adapters remain available for alternate deployments. They are not used by this project's current Brevo configuration. The chat's Brevo connection is a management tool; deployed Django uses its own restricted transactional-email API key so recovery works without this chat running.
