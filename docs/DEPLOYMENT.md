# Deployment and development

## Where everything runs

| Component | Deployment | Address / resource | Cost |
| --- | --- | --- | --- |
| Frontend | Render free static site, `hdfc-bank-web` | https://hdfc-bank-web.onrender.com | $0 within free quotas |
| Frontend (second copy) | Coolify, Acnologia, HDFC-Bank / production, `hdfc-bank-web` | https://www.hdfc-bank.duckdns.org | Same existing Oracle Always Free VM |
| Backend | Coolify, Acnologia, HDFC-Bank / production, `hdfc-bank-api` | https://hdfc-bank.duckdns.org | Existing Oracle Always Free VM, no paid hosting plan |
| MySQL 8.4 | Coolify, Acnologia, HDFC-Bank / production, `hdfc-bank-mysql` | Private Docker hostname `pjd4qwqvg12ls4lj48m8ibj4:3306`, database `defaultdb` | Same existing free VM, no paid database subscription |
| DNS | DuckDNS | `hdfc-bank.duckdns.org` points to **130.210.21.159** | Free |
| API HTTPS | Coolify Traefik / Let's Encrypt | Port 443 | Free, automatic renewal |
| Recovery emails | Brevo HTTPS API | Backend-only API key | Free allowance of 300 emails/day, shared across this Brevo account |
| Source and releases | Public GitHub repository, Actions and Releases | `Vaibhavsh0120/HDFC-Bank`, APK + unsigned IPA | Free public runners/storage within provider limits |

All deployed components use free plans or the existing free VM. No paid plan or upgrade was purchased. Provider quotas, Oracle free-tier capacity and provider policies still apply. Coolify is self-hosted on Volcanica and manages Acnologia; it is not a paid Coolify Cloud subscription. Aiven is retired. The old Render backend is deleted after the replacement passes cutover checks. Render retains its frontend. A second frontend runs on Coolify; both use the same Coolify API and MySQL.

The backend and database share a private Docker network. Django uses the private database hostname, a dedicated `bank` user and verified TLS. A canvas edge documents the connection; environment variables and Docker networking establish it. MySQL also offers a TLS-only endpoint at `hdfc-bank.duckdns.org:3306` for local development option 4. Backend credentials never belong in frontend settings. Old Aiven users, sessions and ledger data were intentionally discarded on 22 November 2026; everyone must register again.

The static Coolify frontend has a 64 MB limit. The API has a 256 MB container limit, one Gunicorn worker and two threads. MySQL has a 512 MB limit, a 128 MB InnoDB buffer pool, at most 40 connections and performance schema disabled. Acnologia has 1 GB RAM and swap. Monitor memory before adding workloads. Django migrations run at backend startup; redeploying does not reset records.

## Root developer menu

Run `./dev.ps1` in PowerShell from the repository root. Python 3.12 and Node.js 22.23.4+ are required. Docker Desktop is required only for option 5. `C` checks tools and `Q` exits.

| Option | Local components | Deployed components |
| --- | --- | --- |
| 1 | Set up `.venv`, backend development requirements and `npm ci` | No cloud changes |
| 2 | Frontend + Django + persistent SQLite demo | None used |
| 3 | Frontend on `http://127.0.0.1:4321` | Coolify API + MySQL |
| 4 | Frontend + Django on `http://127.0.0.1:8000` | **Live MySQL**, requires typing `LIVE` |
| 5 | Frontend + Django + Docker MySQL 8.4 on loopback port 3307 | None used |
| 6 | Encrypt project environments with `agel` and your public age recipient | No cloud changes |
| 7 | Paste a hidden private age identity and restore original environment locations | No cloud changes |

Option 2 is the quick demo. Option 5 uses the real MySQL engine and row locks. Neither overwrites the hosted environment. Ctrl+C stops local servers; option 5 stops its MySQL container and preserves the named `hdfc-bank-dev-mysql` volume. The older `scripts/local-run.ps1` remains available for an installed Windows MySQL server and LAN devices.

Option 4 uses live records and configured email delivery. It checks migrations without applying them. API requests can modify hosted balances; use fictional test users. Local browser origins are permitted by the deployed CORS configuration. Local Docker MySQL binds only to `127.0.0.1:3307`.

Command-line actions: `./dev.ps1 -Action setup`, `demo`, `frontend`, `hosted-db`, `local`, `encrypt`, `decrypt` or `check`. The live database mode always asks for `LIVE`.

## Secrets and encryption

| Original file | Encrypted backup | Purpose |
| --- | --- | --- |
| `backend/.env` | `backend/.env.age` | Database client credentials and base64 CA, Django secret, Google ID, Brevo and administrator provisioning settings |
| `frontend/.env` | `frontend/.env.age` | Public API URL and public Google client IDs |
| `secrets/mysql/.env` | `secrets/mysql/.env.age` | MySQL root and app credentials for recovery |
| `secrets/local/.env` (created by option 5) | `secrets/local/.env.age` after option 6 | Local Docker MySQL credentials |

Option 6 finds `.env` and `.env.*` in the root, backend, frontend and `secrets/`, excluding examples, backups and encrypted files. For `.env`, it changes into that directory and calls your existing PowerShell `agel` function. Additional variants use `age` with `AGE_PUBLIC_KEY`. That recipient must match the private identity you retain. Encryption needs no private key.

Option 7 does **not** call `ageu` or use a machine-specific private-key path. Paste `AGE-SECRET-KEY-1...` into the hidden prompt. It goes to `age -d -i -` through stdin, never command arguments or a key file. Every backup must authenticate successfully before any existing environment is replaced. Failed temporary outputs are cleaned up. Plaintext and temporary files are ignored by Git; encrypted backups can be committed. The private key is never collected or backed up. Retain it separately from the backups it unlocks.

External Android signing keystores and Oracle SSH keys remain separately managed. The menu does not collect files outside this repository. The database CA signing key stays root-only on Acnologia at `/data/coolify/databases/pjd4qwqvg12ls4lj48m8ibj4/tls-authority/`. The public CA is included in the encrypted backend environment. Renew the MySQL server certificate before its expiry, include both the public and private database hostnames, and reload MySQL TLS. Coolify automatically renews the separate API HTTPS certificate.

## Backups and recovery

Coolify schedules a MySQL dump daily at 02:30 UTC (08:00 IST), retaining seven local backups. These are on Acnologia; VM loss can also lose local backups, so separately retain important dumps. Persistent data lives in Docker volume `mysql-data-pjd4qwqvg12ls4lj48m8ibj4`. Do not delete it during redeployment.

For a bad API deployment, redeploy the last working image in Coolify. Reverting code does not reverse database migrations. For data recovery, stop writes and test a SQL dump in a separate database first. Aiven is not a rollback target because its records were intentionally discarded. Update Coolify runtime variables separately from encrypted local backups.

New web/mobile builds use `https://hdfc-bank.duckdns.org`. Install release 1.6.3 or later after the old Render API is deleted: older mobile builds embed the retired URL. Everyone must register again on the fresh database.
