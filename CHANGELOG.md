# Release notes

All money, accounts and virtual cards in this project are fictional. Android 1.1.0 and later use the project release signing key; 1.0.0 used a debug key. iOS IPAs are unsigned and need a compatible signing/container setup.

## 1.6.0 — 2026-11-04

- Use the available desktop width for Profile & settings, with three menu columns on large screens and two on phones.
- Redesign Cards with a card showcase, clearer status and account details, and dedicated PIN-protected controls for freezing, replacement and network changes.
- Add sign-in method management: link/unlink Google, add a password to a Google account, or keep both methods. Confirm identity before changes and retain at least one sign-in method.
- Deliver password and transaction-PIN recovery codes through Brevo's free HTTPS email API, with styled HTML, a centered title and a plain-text alternative.
- Reduce extra iOS header spacing while respecting the reported safe area. Preserve the working native device-unlock flow.
- Document each external service, free-plan limits and secret ownership; refresh the environment example and encrypted backup.

## 1.5.1 — 2026-11-04

- Fix successful Face ID/fingerprint authentication leaving the app locked when the native container still reports an inactive state.
- Distinguish iOS Face ID interruptions from genuine backgrounding. Keep cancellation locked, support retry, and ignore late authentication results after the app enters the background.
- Validate saved native sessions before device authentication; expired sessions return to sign-in and connection failures offer retry.
- Offer device-unlock setup only after the first successful sign-in has loaded the dashboard. Never offer setup on logged-out screens or merely because a token was restored.
- Disable device unlock after logout, session expiry or signing in again. Remember the setup choice so later logins do not repeatedly show the offer; it can be enabled in Security settings.
- Center the content-sized setup dialog within phone safe areas, including landscape.
- Make the native Google sign-in button easier to see with a full-width outline, Google icon and larger tap target.
- Show the dashboard balance and account number by default; the eye button hides or reveals both. Virtual-card details remain masked by default.

## 1.5.0 — 2026-11-04

- Open saved sessions without briefly showing the public landing page. Show a neutral startup screen and dashboard skeleton while loading.
- Add an optional app-only device lock using Face ID, fingerprint or the phone's screen lock. Offer setup after the first app login and enable/disable it in Security settings. Store native sessions in local secure storage; lock protected accounts on backgrounding and at the next launch. Account sign-in remains the recovery path.
- Hide the dashboard balance and account number by default; reveal both with one eye button.
- Hide virtual-card numbers and CVVs by default, with a separate eye button for card details.
- Choose VISA, RuPay or Mastercard for randomly generated, persistent numeric demo cards. Freeze/unfreeze a card or replace its details and network with transaction-PIN confirmation.
- Keep settings in a two-column tile grid on mobile.
- Add a branded 404 screen for missing pages and unknown in-app routes.
- Remove the repeated footer notice throughout the website and app.
- Add an AltStore-compatible LiveContainer source with published iOS version history. Manual iOS releases refresh the source automatically.
- Add version-specific notes for previous releases and reuse these notes in the manual release workflow.

Device unlock requires a phone screen lock and a native app build. It does not change website sign-in or replace the existing transaction PIN. Device hardware and LiveContainer behavior require testing on the target phone.

## 1.4.2 — 2026-11-04

- Launch the native camera directly from the Scan QR button on Android and iOS.
- Keep browser camera scanning, QR-image upload and manual account-number payment available as alternatives.

## 1.4.1 — 2026-11-04

- Align the QR-payment card header, scan action and image-upload control.
- Improve spacing and control presentation in the QR-payment interface.

## 1.4.0 — 2026-11-04

- Harden outgoing-payment locking and PIN validation against concurrent changes.
- Revoke other saved sessions after a password change and reject stale credentials after password recovery.
- Allow removal of legacy saved recipients, including frozen recipients.
- Update REST Framework to resolve the reviewed dependency vulnerability.
- Require MySQL safety tests, schema checks, dependency audits and the web build before mobile packaging.
- Fix long-name overflow and sign-in accessibility, and integrate the payment-method and incoming-alert changes.
- Expand the README, setup instructions, customer-flow audit and trainer study guide; add team credits.

## 1.3.0 — 2026-11-04

- Separate account-number and QR payment methods into distinct paths.
- Improve incoming-money notifications with independent timed alerts while the account is open.
- Integrate the updated payment interface into the main branch.

## 1.2.0 — 2026-11-04

- Add customer contact settings, nominees with guardian details, saved recipients, payment preferences and support requests.
- Add demo virtual-card creation and freeze controls.
- Expand QR payment/receive flows, receipt and statement exports, password recovery and transaction-PIN recovery.
- Add secure transfers and native Google sign-in support.
- Improve iOS safe-area handling, receive-screen positioning, API typing and sign-in loading recovery.

## 1.1.0 — 2026-11-04

- Improve the responsive banking interface across the web and shared mobile app.
- Harden account identity and account-number handling.
- Switch Android packages to the project's release signing key. Updating from 1.0.0 requires uninstalling its debug-signed app first.

## 1.0.0 — 2026-11-03

- First web and mobile release of the Django/React banking simulator.
- Register and sign in, view savings-account details, deposit, withdraw and transfer fictional funds.
- Browse transaction history and mini-statements; manage accounts through Django administration.
- Configure Google OAuth and publish the privacy notice.
- Publish an Android debug-signed APK and unsigned iOS IPA.
