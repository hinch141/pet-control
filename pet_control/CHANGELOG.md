# Changelog

## 2.18.56 — 7 November 2026
- Show last confirmed per-cat access immediately from session cache while refreshing in the background; retain it on cloud timeouts and label stale results.
- Throttle repeated permission lookups and prefetch on startup and return to the app.
- Clarify that whole-house Free Access does not imply every individual cat can exit.
- Force a fresh permission lookup following manual per-cat changes.

## 2.18.55 — 7 November 2026
- Fix rejection when enabling an individual curfew while other unchecked days contain incomplete or identical times.
- Validate times only for enabled individual days; leave disabled days unconfigured without blocking the schedule.
- Default newly migrated weekly curfew days to unchecked until deliberately selected.

## 2.18.54 — 7 November 2026
- Fix Home screen cat cards to display confirmed individual Sure Petcare flap access rather than stale local preference.
- Refresh individual permission information when Home opens and update cards after the result arrives.
- Show Checking while loading, and keep Home and pet profile access labels consistent.
- No changes to actual cat flap permissions.

## 2.18.53 — 7 November 2026
- Display actual confirmed Sure Petcare individual tag permission (Indoor Only / Free Access) on each cat profile rather than stale local preference.
- Refresh permission on opening a cat profile and after manual access updates; show Checking or unavailable when not confirmed.
- Do not change flap access while correcting the display.

## 2.18.52 — 7 November 2026
- Clearly state that individual curfews and manual restrictions remain in place when changing whole-house settings.
- Show manual holds and curfews together with optional guided review.
- Separately confirmed bulk disable of individual curfews retains manual Keep indoors restrictions and saved weekly times.
- Add bulk curfew administration under Settings, separate from whole-house access controls.

## 2.18.51 — 7 November 2026
- Replace alarming whole-house warning with a friendly reassurance that individual settings remain unchanged.
- Make Continue the primary action, with optional Review Jessie / Review cats and Cancel.
- Continue now performs the original whole-house action directly without a second confirmation; guided review remains available.

## 2.18.50 — 7 November 2026
- Warn about individual cat restrictions and curfews before changing whole-house access or enabling/disabling whole-house curfews.
- Guide users through affected cats with previous/next controls and return links from access and curfew settings.
- Preserve individual schedules and manual holds; require final confirmation of the original whole-house change.

## 2.18.49 — 7 November 2026
- Connect seven-day per-cat curfews to a persistent Home Assistant add-on scheduler, running without the phone open.
- Apply individual Sure Petcare tag permissions (Indoor Only / Free Access), independently for each cat.
- Preserve explicit manual Keep indoors until manually restored; never release a manually held cat when a curfew ends.
- Synchronise saved and copied weekly schedules to the add-on and load its authoritative settings when the app opens.
- Preserve the existing whole-house curfew implementation unchanged.
- Temporary override controls remain local-only and are not yet enforced.

## 2.18.48 — 7 November 2026
- Prevent the mobile keyboard appearing automatically after changing a cat's individual access.
- Keep the pet name field editable when deliberately tapped.

## 2.18.47 — 7 November 2026
- Show only Restore Free Access when a cat is currently Indoor Only.
- Show only Keep indoors when a cat is currently on Free Access.
- Wait for verified Sure Petcare permission before offering an access action.

## 2.18.46 — 7 November 2026
- Restore manual per-cat access controls in Edit Pet: Keep indoors and Restore Free Access.
- Read current individual access from Sure Petcare, apply changes to the selected flap tag, and verify the reported result.
- Keep individual curfew settings separate from temporary indoor restrictions.

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
