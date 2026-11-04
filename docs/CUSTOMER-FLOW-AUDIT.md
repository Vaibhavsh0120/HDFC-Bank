# Customer-flow audit — 4 November 2026

This remains a student banking simulation using internal accounts and fictional funds.

The [release review](RELEASE-REVIEW.md) contains the final security findings and current test results; [Setup and operations](SETUP.md) contains deployment and local MySQL instructions.

## Completed flows

| Area | Behavior and failure handling |
| --- | --- |
| Login | Login persists in browser/app local storage for 30 days, migrates existing session storage, synchronizes across tabs, and handles blocked storage or expired credentials. Offline sign-out offers local removal. |
| QR payments | Send/receive hub, native Android/iOS scanner, browser camera, image upload, optional amount/note, QR image export, manual entry, rejection of unsupported or self QR codes, server recipient lookup, review, PIN and receipt. Camera tracks stop on close or backgrounding. |
| Payments | Atomic ledger and balance updates, request-ID replay, pending-request recovery, insufficient-fund/frozen-account feedback, and outgoing-payment lock enforced by the backend. Definitively rejected pending requests can be edited again. |
| Personal details | Editable name, phone and address. Email changes require the current password, reject duplicate addresses and update email-password login. Google-only users can create a password through recovery. |
| PIN | Setup, change, attempt lockout and email-code recovery. Recovery clears the PIN lock. |
| Password | Change password, request code, confirm reset, password-strength validation, code expiry, five-attempt limit, resend cooldown and single-use consumption. Reset invalidates all access tokens; a password change revokes other bearer sessions and pending password-reset codes while preserving this login. |
| Nomination | One nominee with a 100% share, name, relationship, birth date and address; guardian details required for minors; PIN-protected edit/removal. |
| Recipients | Account validation, saved nicknames, duplicate prevention, removal confirmation and selection during transfers. |
| Virtual card | Persistent demo-card creation, idempotent issue requests, PIN-protected freeze/unfreeze and account-isolated access. Frozen bank accounts cannot change cards. |
| Statements | Search/filter/history, downloadable CSV with spreadsheet-formula escaping, and downloadable/shareable receipt text. Native files use the platform share sheet. |
| Preferences | Outgoing-payment lock and in-app incoming-transfer alerts. Daily limits and email verification were omitted at the user's request. |
| Support | Saved requests, references, topic, status and administrator replies; help for interrupted payments, frozen accounts and closure requests. |
| iPhone layout | Top safe-area spacing on public/account/privacy pages, native portrait fallback, side/bottom insets and modal clearance. |

## Verification

- Django: 54 tests total, all passed against a separate local MySQL 8.0 instance. SQLite also passed 52 tests and skipped its two MySQL-only concurrency tests.
- Browser: completed registration, persistent-login reload, deposit, QR image payment between two accounts, receiver balance, contact editing, minor nomination, saved recipient, payment lock/unlock, card issue/freeze, support submission and CSV export.
- Browser: the API committed a withdrawal and the browser response was deliberately aborted. After reload, retrying the saved request recovered its receipt and left the balance debited exactly once.
- Browser: completed emailed PIN reset, emailed password reset and sign-in with the new password using local file-based email delivery.
- Responsive screenshots and DOM geometry checked at 390, 1440 and 1728 pixels; no horizontal overflow on settings. Native iPhone portrait simulation placed the landing logo 83 pixels below the viewport top.
- Final review: 43 rendered route/form states passed the selected axe WCAG A/AA rules and overflow checks. A maximum-length customer name also passed 15 layout checks at 320, 390, 768, 1440 and 1728 pixels after the desktop header fix.
- Frontend type checking and production build passed. Android debug compilation passed with JDK 21 and the native scanner/file-sharing plugins.
- iOS privacy-manifest resource registration was verified against the Capacitor Xcode project template. The iOS binary was not compiled on Windows.
- Better Design tools were requested but returned the monthly call-limit error; no Better Design review or spacing score is claimed. Direct screenshots, DOM measurements and flow tests supplied the local review evidence.

## External dependencies and limits

- No SMTP or HTTPS-mail credentials were found in the local backend configuration. Email delivery is implemented and tested locally, but hosted inbox delivery still needs sender credentials. The connected Render service is on the free plan, whose standard SMTP ports are blocked; an HTTPS email backend is included for that case. The Render connector exposes service details but no read-only environment-variable endpoint, so hosted secret values were not inspected or changed.
- Camera scanning and file sharing have not been tested on physical Android/iPhone devices. iPhone notch clearance has been simulated; physical-device confirmation is still needed.
- No external UPI, real-money bank rails, merchant card processing, regulated KYC or legal nomination service is connected. The interface identifies internal transfers, virtual funds and demo cards accordingly.
- Production migrations/deployment and mobile release publication must be verified after the source push. Existing production credentials and encrypted backups were preserved.

## Reproducing the browser check

Run the API with `--settings=config.demo_settings` on port **8011**. Start Astro on port **4322** with `PUBLIC_API_URL=http://127.0.0.1:8011`. Then run:

```powershell
npx --package @playwright/cli playwright-cli -s=bank-audit open http://127.0.0.1:4322/
npx --package @playwright/cli playwright-cli -s=bank-audit run-code --filename scripts/ui-smoke.cjs
npx --package @playwright/cli playwright-cli -s=bank-audit run-code --filename scripts/ui-layout.cjs
```

Run the commands from the repository root. The script uses relative artifact paths and creates fictional local fixtures. Screenshots, CSV and review emails are written to ignored `artifacts/`. Password/PIN email consumption was additionally verified interactively against those local emails during the earlier customer-flow work; the final review reran the API recovery tests. Browser test success does not prove hosted inbox delivery.
