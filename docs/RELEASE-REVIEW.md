# Final project review

**Review date:** 4 November 2026 · **Scope:** application source, API, financial rules, account security, frontend flows, migrations, dependencies, deployment configuration, release workflow and documentation.

This is an educational banking simulation. The checks below support a trainer demonstration and source handoff; they do not certify a real banking system or guarantee a mark against a rubric that has not been supplied.

## Version 1.6.2 follow-up

The real local API notification walkthrough transfers funds between two accounts, interrupts the initial polling request, and verifies the correct credited amount/sender, QR flip, eight-second reset, tap dismissal, unchanged banner on other pages, no replay after reload and reduced-motion behavior. Observed local delivery latency was about 1.2 seconds; hosted latency depends on network and free-host availability. The dashboard's initial incoming cursor prevents the first-poll timing gap. Polling progress survives temporary errors and tab reloads. Notifications remain in-app alerts.

The failed 1.6.0 run had successful Android/iOS builds; publication returned GitHub HTTP 403 while targeting historical workflow source after main advanced. Reserving the tag alone did not repair the old publication command, which still supplied the historical target. New releases reserve their tags early and publish with `--verify-tag` without the redundant historical target. Both platform builds still depend on passing verification. The existing 1.6.0 artifacts can be recovered without rebuilding. Version 1.6.1 was already published successfully.

Both hosted password and PIN recovery requests returned 200 and their separate emails arrived in the maintainer-owned Gmail test alias. Delivered messages passed SPF, DKIM and DMARC; code consumption remains covered by isolated tests.

## Version 1.6.1 follow-up

The recovery email's section heading is centered alongside its main title. A selectable six-digit code and copy instruction work without email JavaScript; a custom clipboard button is not offered because normal email clients do not support it. The Brevo delivery preview reached Gmail with SPF, DKIM and DMARC passing. Brevo's warning for the configured Gmail sender remains expected: its automatic compliant sender rewrite is active, and authenticating `gmail.com` itself would require control of Google's DNS. No hosting or email plan was upgraded.

## Version 1.6.0 follow-up

Profile menus now use the dashboard width (three columns on large desktops, two on phones). Security has a two-column desktop layout. The redesigned card uses standard debit-card proportions, a masked number/CVV, clear status and separate PIN-protected controls. Five-width browser checks cover 320, 390, 768, 1440 and 1728 pixels without horizontal overflow.

Sign-in method changes require password confirmation or a newly issued, server-verified Google identity token. Linking is explicit, identities cannot be shared across banking users, and Google-only accounts must add a password before unlinking. A user-row lock coordinates Google session creation and unlinking. Unit tests cover both methods, incorrect credentials, old/wrong Google proofs, account isolation, last-method protection and session revocation. Browser checks exercise the forms with a simulated Google selection; a live account-linking OAuth interaction remains a separate device/provider check.

Brevo Free is configured for HTTPS recovery delivery on Render Free. Both PIN and password reset messages have HTML/plain-text content, centered titles, continuous six-digit codes and explicit subjects. A delivery/design preview was accepted by Brevo and independently found in the maintainer's Gmail inbox. Production endpoint verification is recorded separately after deployment. Google/Gmail decides whether to offer copy-code cards; no app mailbox access or guaranteed autofill is claimed.

Local evidence: 63 Django tests (61 passed, two MySQL-only skips); seven device-unlock policy tests; three release/source tests; Astro check without errors/warnings; production build; account/payment smoke, card replacement/network checks, sign-in method UI and iOS/Android simulated-bridge regression checks. The user confirmed working Face ID on their actual iPhone after 1.5.1. Physical Android authentication and the newly built mobile packages still need device checks. Better Design's free monthly quota was exhausted, so its review tools returned no result; rendered screenshots and direct DOM measurements were used for this review.

The [service inventory](SERVICES.md) documents the free service plans and each service's role. `.env.example` contains placeholders; `.env` is ignored, Render was configured separately, and PowerShell `agel` refreshed the tracked encrypted backend backup.

## Version 1.5.1 follow-up

The patch addresses the reported iPhone unlock dead end and setup-dialog height. Device authentication success no longer depends on an immediate active-state read or a foreground event. Genuine iOS backgrounding still invalidates an in-progress attempt; Android authentication-activity interruptions do not trigger a second lock. Native session validation prevents authentication/setup prompts for expired logins. Setup is gated on a fresh login reaching the dashboard, and logout disables the lock while retaining the completed-choice marker.

The user's latest visibility preference is implemented: dashboard balance and account number start visible and toggle together. Virtual-card details still start masked. Native Google sign-in has a provider icon, visible border and full-width 52px control. The setup dialog uses content height and safe-area centering.

The updated native regression script exercises iOS and Android bridges in WebKit, including stale/missing foreground state, cancellation/retry, logout, expired tokens, one-time setup timing and measured dialog geometry. Bridge tests and screenshots are local evidence; physical-device confirmation remains separate. Version-specific release notes are in [CHANGELOG.md](../CHANGELOG.md).

## Version 1.5.0 follow-up

The [changelog](../CHANGELOG.md) records all seven earlier versions and the 1.5.0 changes. Existing GitHub release bodies were updated with their own tag-range changes. The [LiveContainer source](https://raw.githubusercontent.com/Vaibhavsh0120/HDFC-Bank/main/apps.json) was initialized from the seven published iOS IPAs; the mobile release workflow now refreshes it after successful iOS publication. The source is maintained as `apps.json` on `main` so no extra source branch is needed. The workflow uses authored notes or GitHub's generated commit notes for future versions.

Local checks for this update: 56 Django tests (54 passed, 2 MySQL-only skips), migration drift clean, seven device-unlock policy tests, three release/source tests, zero Astro errors/warnings/hints, successful production build, zero npm audit vulnerabilities and actionlint success for all three workflows. The account/payment smoke check and the new v1.5.0 UI check passed. Five-width settings measurements, startup DOM observation, card masking/network/replacement, 404 behavior and native-bridge integration were exercised. Android debug compilation passed with the new native plugins; no physical biometric or iOS runtime claim is made.

Device unlock is optional and app-only; its first-login offer remembers either choice. Native bearer sessions use local Keychain/encrypted storage and migrate away from WebView local storage. An enabled lock removes account UI on backgrounding, and cancellation leaves it locked. A fresh server-authenticated login is the recovery route. This is a local interface lock with OS authentication, not a hardware-bound server authorization scheme. Transaction PIN and server validation remain separate controls.

The original 54-test MySQL review below is historical evidence. The [manual 1.5.0 release run](https://github.com/Vaibhavsh0120/HDFC-Bank/actions/runs/41823387366) passed the expanded MySQL/frontend gate, built and published both packages, and automatically refreshed the source to 1.5.0. [The release](https://github.com/Vaibhavsh0120/HDFC-Bank/releases/tag/v1.5.0) targets `581b3ee`. Its APK is release-signed and its IPA unsigned. The live website serves the neutral startup and branded HTTP 404; the API health endpoint returned 200. Face ID/fingerprint/passcode behavior, app-switcher snapshots and keychain persistence must still be confirmed on the target phone/container.

## Findings and fixes

| ID | Severity | Finding | Resolution and evidence |
| --- | --- | --- | --- |
| F-01 | High | A concurrent payment-lock update could compare against a stale snapshot and unlock payments without a PIN. | Compare against the locked account row inside the transaction. Regression reproduces the bypass; missing/incorrect PINs now leave the lock intact and failed attempts persist. |
| F-02 | High | Changing a password left other bearer sessions and earlier password-reset codes valid. | Retain only the current bearer session; revoke other sessions and outstanding password-reset challenges. Tests verify the retained login, rejected old session and rejected code. |
| F-03 | High | A login using credentials validated just before password recovery could issue a fresh token after recovery revoked prior sessions. | Recheck the authenticated password snapshot, active status and login identity under the same user lock used by password changes/recovery before issuing a token. Regression tests cover password, active-status and username changes. |
| F-04 | Medium | Removing a saved legacy account returned success without deleting it when its stored account number was null. | Resolve legacy and current account numbers through the shared lookup, then delete only this customer's saved pair. A frozen legacy recipient can also be removed. |
| F-05 | High | The REST Framework dependency ceiling retained a version flagged by the Python vulnerability audit. | Upgrade to REST Framework 3.18.3+, raise Django's minimum to the audited 5.2.19, update development stubs, and rerun API tests and the vulnerability audit. |
| F-06 | Medium | Mobile packaging had no automated API/database correctness gate; the browser script used a developer-specific absolute path. | Add a reusable verification workflow and isolated loopback-only MySQL test settings. Mobile preparation depends on verification. Smoke artifacts now use relative paths; the script simulates a lost committed response and a safe retry after reload. |
| F-07 | Medium | A valid 150-character name pushed the desktop header beyond the viewport. Google sign-in also placed an accessibility label on a generic container that cannot be named. | Constrain and truncate the header name while keeping the full text in the DOM; remove the invalid label. A regression checks 15 route/width combinations. The final screen scan reports no violations in its tested WCAG rule subset. |

Each functional defect was reproduced before its fix. Backend fixes include regression tests. Changes are recorded in separate commits with finding IDs.

## Verification results

| Check | Result |
| --- | --- |
| Full Django suite on MySQL 8.0.43 | **54 passed, no skips**, using a separate local instance and disposable test database. Includes real InnoDB concurrent withdrawal and request-replay tests. |
| Isolated SQLite suite | **52 passed, 2 skipped**. SQLite cannot verify MySQL row locks. |
| Django system checks and migration drift | No issues; no uncreated model migrations. Existing migrations applied successfully to the fresh MySQL test database. |
| Python dependency consistency/audit | `pip check` passed; `pip-audit --local` found no known vulnerabilities after the upgrade. This is a point-in-time dependency scan. |
| Frontend type check and production build | Passed, with zero errors, warnings or hints from Astro checking. |
| npm dependency audit | Zero reported vulnerabilities. |
| GitHub workflow syntax | Both workflows passed actionlint 1.7.12. Hosted execution is a separate check. |
| Browser customer journey | Registration, login persistence, deposit, QR-image transfer, recipient balance, PIN setup, interrupted withdrawal/reload/replay, contact details, nominee with guardian, recipients, payment lock, demo-card issue/freeze, support and CSV export passed. |
| Screen/accessibility sweep | 43 rendered states: 12 account routes at 390/1440/1728 pixels, profile edit and transfer dialog, plus home, login, registration, recovery and privacy. No horizontal overflow; zero axe violations for the tested WCAG A/AA and 2.1 AA tags after the accessibility fix. This is automated coverage, not a full manual WCAG certification. |
| Long-name regression | Overview, settings and cards fit at 320, 390, 768, 1440 and 1728 pixels with a valid maximum-length customer name. |
| Documentation rendering | Both README flowcharts and all three study-guide diagrams rendered successfully with Mermaid; screenshot assets and local documentation links resolved. |
| Integrated payment UI regression | Teammates' fixture-based test passed separate manual/QR paths, validation, own/invalid QR handling, payment lock, Escape dismissal and simultaneous timed incoming notifications at four viewport widths. Fixtures do not contact a bank API. |
| Android debug package | The final merged frontend was synchronized with Capacitor and `assembleDebug` passed using JDK 21. Generated project files/APK remain ignored; no mobile release was published. Gradle reported existing flat-directory and duplicate Kotlin-plugin configuration warnings. |

Backend results were rerun with Django 5.2.19 and REST Framework 3.18.3. Local frontend checks used Node.js 26.13.0; the workflow selects Node 22 as declared by the project. MySQL test password hashes are deliberately fast; the ordinary app and sequential demo retain PBKDF2. No hosted database was used for these tests.

The review preserved the existing design. Better Design tools were requested for principles, review, comprehension and spacing, but returned the monthly quota error. No Better Design score or completed measurement is claimed; direct screenshots, DOM widths, axe checks and flow testing supplied the available evidence.

The final integration also preserves the teammates' existing payment-method/notification changes and team credits from GitHub. The browser smoke check was updated to enter the separate QR-payment flow before uploading an image.

## Reproduce the checks

Start with [the README](../README.md#run-a-local-demo) for an isolated demo, then follow [Setup and operations](SETUP.md#testing) for MySQL testing and dependency/build commands. From the repository root with the demo API and frontend running:

```powershell
npx --package @playwright/cli playwright-cli -s=bank-audit open http://127.0.0.1:4322/
npx --package @playwright/cli playwright-cli -s=bank-audit run-code --filename scripts/ui-smoke.cjs
npx --package @playwright/cli playwright-cli -s=bank-audit run-code --filename scripts/ui-layout.cjs
```

Both scripts create fictional users against loopback port 8011 and write outputs under ignored `artifacts/`. The browser sweep used a locally installed axe-core; it is not a frontend runtime dependency. Screenshots, local test databases, audit tooling and recovery emails are not release assets.

## Remaining external checks

- **Hosted recovery:** configure an email sender and verify actual inbox delivery before demonstrating hosted password/PIN recovery. The final review tested local/API recovery behavior and mocked provider acceptance, not a production inbox.
- **Native hardware:** camera scanning, file sharing, Google account login and safe areas need physical Android/iPhone checks. iOS compilation/signing was not performed on Windows. Previous local Android build evidence is described in the customer-flow audit; this review does not claim a newly published mobile binary.
- **Hosting and Actions:** confirm the pushed commit is deployed by Render and that GitHub Actions is allowed to execute. A local build and valid workflow do not prove a hosted run.
- **Trainer rubric:** the application uses one Django domain app and no custom banking many-to-many field. The trainer must assess these against the actual assignment. Team contributions and reviews must reflect real work.

## Scope limits worth explaining

- Funds, internal account transfers, cards and nomination records are fictional. The app does not implement external payment networks, KYC, card authorization or bank settlement.
- Registration and contact changes do not verify email ownership. Deposits are intentionally available for demonstration. There is no configured daily transfer limit.
- Browser bearer sessions are stored in browser storage for up to 30 days; since 1.5.0, native sessions use local Keychain/encrypted storage. Script access inside an unlocked app remains a risk. Device unlock, PIN protection and HTTPS do not replace preventing script injection.
- Request throttling uses the default per-process cache; it is not a distributed abuse-prevention system. Incoming alerts use polling while the app is open, not guaranteed background push delivery.
- Production security checks retain Django's two advisory notices about HSTS subdomains/preload. Those settings were not enabled blindly for a shared hosting domain; HTTPS redirects, secure cookies and one-year HSTS are already configured for production.

For the demonstration narrative, database relationships, API routes and sample SQL, use the [trainer study guide](PROJECT-STUDY-GUIDE.md).
