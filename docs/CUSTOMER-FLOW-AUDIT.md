# Customer-flow audit — 4 November 2026

This remains a student banking simulation using internal accounts and fictional funds.

## Version 1.6.0 follow-up

- Profile/settings fills the desktop content area; phone menus retain two columns. Card controls and sign-in method management were checked at 320–1728px, including standard debit-card proportions.
- Explicit Google linking/unlinking and adding a password to a Google-only account retain at least one sign-in method. Backend identity verification and form behavior have separate test coverage.
- Both password and transaction-PIN recovery deliver codes to the registered email using Brevo HTTPS. A styled delivery preview reached the maintainer's inbox. Production recovery verification is tracked in the release review.
- The user confirmed Face ID now succeeds on their iPhone. iOS/Android simulated lifecycle regression checks still pass; physical Android confirmation is outstanding.
- See [services](SERVICES.md) for hosting, database, email, authentication and release responsibilities and free-plan boundaries.

The [release review](RELEASE-REVIEW.md) contains the final security findings and current test results; [Setup and operations](SETUP.md) contains deployment and local MySQL instructions.

## Version 1.5.1 follow-up

The user's iPhone screenshots reproduced an oversized setup dialog and an account remaining locked after successful Face ID. The unlock path previously required `App.getState().isActive` immediately after authentication. That state can remain inactive while iOS dismisses its overlay. The patch accepts the successful OS result, clears any transient privacy cover, distinguishes true iOS backgrounding from the Face ID interruption, and ignores stale results from interrupted attempts.

Setup now waits for a fresh authenticated login and a successful dashboard response. Saved native sessions are validated before prompting; an expired token never opens device authentication. Logout disables the lock and remembers the completed setup choice. Balance/account visibility defaults were changed to visible at the user's request; virtual-card masking remains unchanged. The native Google control has a full-width outline and provider icon.

WebKit regression checks cover both simulated iOS and Android bridges: no setup while logged out or merely restoring a token, successful authentication with both a stale inactive result and a missing foreground event, real background lock, cancellation/retry, logout disabling protection, dashboard-gated setup, a remembered decline, later logins without repeated setup, expired-session recovery, Google-button geometry and phone-safe dialog layout at 320, 390, 393 and 844 pixels. These tests run actual plugin JavaScript against a simulated bridge; they do not certify physical Face ID/fingerprint or LiveContainer hardware behavior.

## Version 1.5.0 follow-up

- Saved-session startup renders a neutral server/client loading state; a DOM observer confirmed the public landing page never mounted for a saved login. Slow account responses show a dashboard skeleton.
- The overview balance and full account number start masked and share one eye control. Card number/CVV start masked; an eye reveals them. Card creation, RuPay selection, freeze, replacement with Mastercard, preserved freeze state and remasking on reload passed against the isolated API.
- Mobile settings retain two columns at 320, 390, 768, 1440 and 1728 pixels. The changed screens were reviewed in screenshots and measured directly for overflow. Unknown hash routes and missing HTTP paths render the custom 404 and return to the account successfully. The repeated footer notice was removed from all application/public screens.
- Native integration was tested through the real plugin JavaScript with a simulated Capacitor bridge: legacy-session migration, the first-login offer, remembered decline, enable/disable confirmation, cold-open lock, background lock, cancellation, retry, a missing screen lock and a cancelled enable. This caught and fixed a native storage initialization hang caused by resolving a Promise with a Capacitor proxy. These checks do not simulate the phone's actual biometric hardware.
- The existing end-to-end account/payment/recovery/settings smoke check passed after updating its balance-visibility and card-creation assertions. The isolated Django suite now has 56 tests: 54 passed and the 2 MySQL-only concurrency checks skipped on SQLite. Seven device-unlock policy tests and three release/source tests passed.
- Android debug compilation succeeded with the authentication, secure-storage and app-lifecycle plugins. Physical-device/LiveContainer authentication and iOS runtime behavior still need target-device confirmation; hosted build results are separate from this local evidence.
- Hosted follow-up: [the manual release run](https://github.com/Vaibhavsh0120/HDFC-Bank/actions/runs/41823387366) passed the MySQL/frontend gate, built both platforms, published [1.5.0](https://github.com/Vaibhavsh0120/HDFC-Bank/releases/tag/v1.5.0) and refreshed the source automatically. The catalog was then moved onto `main` to honor the user's single-branch request. YashikaPachori's existing write access was verified; published commit authors were preserved.

The original review below records the pre-1.5.0 baseline.

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
npx --package @playwright/cli playwright-cli -s=bank-audit run-code --filename scripts/v150-ui-smoke.cjs
npx --package @playwright/cli playwright-cli -s=bank-audit run-code --filename scripts/native-unlock-smoke.cjs
npx --package @playwright/cli playwright-cli -s=bank-audit run-code --filename scripts/ui-layout.cjs
```

Run the commands from the repository root. The script uses relative artifact paths and creates fictional local fixtures. Screenshots, CSV and review emails are written to ignored `artifacts/`. Password/PIN email consumption was additionally verified interactively against those local emails during the earlier customer-flow work; the final review reran the API recovery tests. Browser test success does not prove hosted inbox delivery.
