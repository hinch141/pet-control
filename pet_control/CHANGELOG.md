# Changelog

## 2.18.45 — 7 November 2026
- Make the individual flap permission check expandable and collapsible.
- Allow read-only results to be hidden after checking.
- Remove the obsolete Jessie-only test button from the Curfews page.

## 2.18.44 — 7 November 2026
- Fix curfew cancellation so an explicit Off command attempts to restore Free Access even when an earlier lock confirmation was incomplete.
- Record ownership before issuing the timed lock command, allowing the end-of-curfew retry to recover after a partial success.
- Restore availability of the manual flap control when the curfew is disabled.

## 2.18.43 — 7 November 2026
- Reject curfew ranges with identical start and end times before saving.
- Warn when a daytime curfew range has already finished today, and require confirmation to save it for tomorrow's daily run.
- Preserve overnight curfew ranges that cross midnight.

## 2.18.42 — 7 November 2026
- Fix the date-selection bug that skipped upcoming curfew times.
- Replace one-off scheduling with a daily whole-house schedule supporting up to 12 time ranges, including overnight ranges.
- Move time editing into a popup with Add another range and Save times.
- Keep Home screen compact, show live status and support immediate cancellation.
- Preserve manual flap lock ownership so disabling a curfew does not unlock a pre-existing manual lock.

## 2.18.41 — 7 November 2026
- Add a one-off whole-house curfew with start and end time fields beside the existing Indoor-only control.
- Run curfew from the Home Assistant add-on, even with the app closed.
- Allow curfew cancellation at any time, restoring Free Access when the curfew owns the lock.
- Show scheduled, active and error states; retain manual flap control when curfew is off.

## 2.18.40 — 7 November 2026
- Show a manually changed cat location immediately after Sure Petcare accepts it.
- Display a synchronising message until Home Assistant confirms the new location.
- Preserve automatic tracking and revert to tracked status if confirmation is delayed beyond three minutes.

## 2.18.39 — 7 November 2026
- Added release notes for Home Assistant's add-on update screen.
- No changes to pet tracking, flap permissions or curfews.

## 2.18.38 — 7 November 2026
- Show only the relevant manual location action on a cat's profile.
- Replace browser-style confirmation and error popups with in-app messages.

## 2.18.37 — 7 November 2026
- Restore Home Assistant's automatic cat-location tracking.
- Correct pet-ID validation for manual Sure Petcare location requests.

## 2.18.36 — 7 November 2026
- Add manual Inside/Outside location controls to cat profiles.
- Add direct Sure Petcare location checks; manual update still requires live confirmation.

## 2.18.35 — 7 November 2026
- Match spacing below the live flap lock panel to other cards.

## 2.18.34 — 7 November 2026
- Move whole-house live lock status directly beneath the Indoor-only switch.
- Clarify that whole-house status does not represent individual curfews.

## 2.18.33 — 7 November 2026
- Remove inactive exit-permission preferences from Edit Pet.
- Link each pet's editing screen to its curfew settings.

## 2.18.32 — 6 November 2026
- Increase cat photo sizes and show photos in Curfews.

## 2.18.31 — 6 November 2026
- Add per-pet photos stored locally on the current device.

## 2.18.30 — 6 November 2026
- Add Sync Pets from Sure Petcare and link existing pet profiles.
