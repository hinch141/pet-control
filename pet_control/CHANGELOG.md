# Changelog

## v2.18.134 — 10 November 2026
- Show a single View diagnostics button and a separate Download diagnostic report button; downloading never requires opening the diagnostics view or making new Sure Petcare requests.
- Collect cat-specific In/Out movement observations from existing activity fetches and Home Assistant status transitions in the background, with observed timestamps and source event times.
- Keep existing request timing and error details, bounded persistence and unchanged access controls. Cat-specific records identify only known household pets; no credentials or raw cloud payloads are logged.
- First observed events and status changes are not proof of exact physical-to-screen latency; no extra cloud polling is introduced.


## v2.18.133 — 10 November 2026
- Measure Sure Petcare queue wait separately from actual network response time using existing requests only.
- Classify cloud failures as timeout, network, HTTP, authentication or rate limiting without exposing credentials.
- Record when movement events are first observed in a session; event age is not a verified physical-to-screen delay.
- Improve Reliability Check with UK times, readable labels, averages, and an exportable JSON report.
- Keep a bounded 240-record diagnostic history in Home Assistant /data across restarts (approximately tens of kilobytes); existing pet history, lock commands, curfews and request frequency unchanged.
- Keep v2.18.129 protected in backup/pet-hq-v2.18.129-pre-reliability-2026-11-10.

## v2.18.132 — 10 November 2026
- Fix a silent Reliability Check button by using a direct click handler in the main Pet HQ page rather than relying on a separate script file loading.
- Display a loading message immediately, and always display either results, an empty-state message or a clear error.
- No changes to cat access, curfews, cloud polling or retained history.

## v2.18.131 — 10 November 2026
- Fix app startup: include reliability-diagnostics.js in the Docker image. The previous v2.18.130 release imported this module but did not copy it into the image, causing a Node.js MODULE_NOT_FOUND error.
- Preserve all existing app data, settings, curfews and history; no changes to the locking algorithms.
- Retain the v2.18.129 backup branch for rollback.

## v2.18.130 — 10 November 2026
- Added a read-only reliability check in Settings, with bounded timing and error records from existing Home Assistant and Sure Petcare requests.
- Added response-time records for existing lock and individual access commands without sending extra requests.
- No new cloud polling or changes to curfew and lock behaviour.

## v2.18.85
- Added a user-controlled PWA update notification and refresh mechanism for future Android home-screen installs.
- Service worker now precaches the app shell and live.js, checks for updates when the app is reopened or focused, and activates a new version only after confirmation.
- Kept Ingress and authentication boundary unchanged; no external port or unauthenticated endpoint exposed. Curfew and Sure Petcare logic unchanged.


## v2.18.84
- Corrected the misleading individual curfew subtitle to describe live automatic schedules.
- Added dimensional card shadows, raised buttons, layered gradients, and richer navigation styling without changing application logic.


## v2.18.83
- Renamed app branding to Hinchliffe Pet HQ, with a friendlier tagline and updated installable web app manifest.
- Improved visual contrast, colourful cards, gradients, buttons and navigation. No scheduler or permission changes.
- Corrected outdated Settings wording: individual curfews and manual access controls are live; household invitations remain incomplete.


## v2.18.82
- Refreshed colours, pet cards, status pills, navigation and activity presentation without modifying server-side commands or scheduling.
- Added per-cat daily inward entry counts on the home cards using existing cached Sure Petcare activity; no extra API requests.


## 2.18.81 — 7 November 2026
- Correct the scheduler Sure Petcare request timeout: its 12-second countdown now begins when the queued network request starts, not when it joins the rate-limited queue.
- Preserve three-second request pacing and existing 429 cooldown.
- No automatic retry of an uncertain write; curfews remain disabled pending controlled testing.

## 2.18.80 — 7 November 2026
- Curfew event history opens with five recent events, with a button to show five more at a time. Existing history is retained.
- Permission write errors now identify uncertain timeouts and elapsed time rather than implying a rejected command.
- No automatic retry added for uncertain write outcomes; individual curfews should remain disabled pending controlled verification.

## 2.18.79 — 7 November 2026
- Preserve curfew ownership through uncertain Indoor Only cloud readbacks so the release obligation is not silently lost.
- Read a new Sure Petcare dashboard snapshot for each cat instead of sharing a potentially stale snapshot across overlapping transitions.
- Explicitly log cloud-reported Free Access separately from physical flap verification; avoid calling cloud readback a physical success.
- Pace release retries at 30 seconds, retain errors and manual override precedence.
- Individual curfews remain unverified at the physical flap; leave disabled pending controlled tests.

## 2.18.78 — 7 November 2026
- Classify failed individual permission reads as rate-limited, timed out, network error, or other request error instead of hiding all failures behind one generic message.
- This is a diagnostic release; no claim of performance improvement or automatic curfew reliability.

## 2.18.77 — 7 November 2026
- Reuse a successful read-only cat-permissions snapshot for 20 seconds, reducing duplicate Sure cloud requests when navigating between cats.
- Invalidate cached permission snapshots after successful cloud writes.
- Defer optional historical archive backfill while a user has recently inspected or changed pet permissions.
- Preserve central Sure request spacing and HTTP 429 protection. Curfew automation remains unverified.

## 2.18.76 — 7 November 2026
- Correct shared Sure Petcare session caching to use a consistent X-Device-Id across all server requests instead of new device identities for each route.
- Display a specific cooldown message when a read-only permission check is blocked by the rate limiter.
- Keep individual curfews disabled during investigation; no permission changes in this release.

## 2.18.75 — 7 November 2026
- Route Sure Petcare requests from all server endpoints and archive backfill through one global serialised request limiter (minimum three seconds between requests).
- Reuse authenticated Sure Petcare responses for ten minutes, deduplicating concurrent logins, with hashed credential cache keys.
- Briefly cache dashboard snapshots, invalidating on permission/location writes.
- Respect HTTP 429 Retry-After or pause outbound requests for five minutes by default; clear cached sessions on rate limiting or unauthorised responses.
- Existing frontend polling remains but no longer causes a fresh cloud login on each read.
- This is a protective change; physical flap permission propagation and overlapping curfew reliability still require validation.

## 2.18.74 — 7 November 2026
- Individual curfew release no longer blocks on an immediate Sure Petcare read-after-write check.
- Confirm Free Access from later cloud snapshots; retry an unconfirmed release no more frequently than every 20 seconds.
- Retain scheduler ownership and a visible pending confirmation message until the cloud reports Free Access.
- No changes to manual holds or whole-house curfews.

## 2.18.73 — 7 November 2026
- Trigger an immediate Home Assistant presence refresh whenever the Home tab is selected, in addition to existing five-second polling and foreground refresh.
- Add a 12-second timeout to presence polling so a stalled request cannot block subsequent refreshes indefinitely.
- Keep the shared Home/Away display logic from v2.18.72; no access-control or curfew changes.

## 2.18.72 — 7 November 2026
- Home cards now use the same effective Home Assistant presence status as the live refresh and pet detail, rather than rebuilding from a separate raw value during unrelated rerenders.
- Preserve any pending manual location display override consistently until Home Assistant confirms or it expires.
- No changes to cat access commands or curfew scheduling.

## 2.18.71 — 7 November 2026
- Curfew diagnostics and event-history buttons now toggle their respective expanded results closed on a second tap.
- No changes to automatic access scheduling or Home Assistant presence sensors in this release; both are under investigation after the overlapping-curfew test.

## 2.18.70 — 7 November 2026
- Prevent the individual curfew scheduler from surrendering ownership immediately when Sure Petcare briefly reports the pre-write Free Access state after an Indoor Only command.
- Allow up to 60 seconds for cloud status propagation before treating Free Access as an external change; preserve explicit manual overrides.
- Record an external-access-detected event when ownership is relinquished after the grace period.
- Maintain owned restrictions for automatic release and retry at curfew end.

## 2.18.69 — 7 November 2026
- Fix Edit times after the already-passed individual curfew warning: retain the selected day and unsaved time edits instead of reloading the previous server schedule and unchecking the day.
- Return to the existing editor without sending the draft to Sure Petcare until the user makes a subsequent change or confirms saving.

## 2.18.68 — 7 November 2026
- Add a save confirmation when an enabled individual curfew for today has already finished; display the next occurrence next week.
- Apply the same check to individual-day, same-all-week and copied schedules via the common save path.
- Provide Save schedule and Edit times options; editing restores the server's last saved schedule before making further changes.
- Do not warn for future weekdays, active windows or overnight schedules that finish the following day.

## 2.18.67 — 7 November 2026
- Match whole-house curfew time editing to individual curfews: editing a start time automatically sets its end one minute later, including midnight wrap.
- Keep end times editable and preserve previously saved whole-house ranges unless their start is changed.
- Initialise additional whole-house ranges with 22:00–22:01 rather than an overnight default.
- Keep all existing whole-house and individual curfew scheduling rules unchanged.

## 2.18.66 — 7 November 2026
- Correct misleading edit-pet warning that described all Sure Petcare lookup failures as an unmatched flap tag.
- Distinguish connection/authentication failures from genuine tag matching failures, displaying the server-provided explanation.
- Do not change cat access or curfew settings.

## 2.18.65 — 7 November 2026
- When changing an individual day or all-week curfew start, automatically initialise the end time to one minute later.
- Handle midnight wrap (23:59 to 00:00); the end time remains editable for longer curfews.
- Do not alter existing saved curfew times unless the start time is edited.

## 2.18.64 — 7 November 2026
- Prevent incomplete or unsuccessful Sure Petcare permission responses from clearing previously confirmed individual access states.
- Merge only valid confirmed cat permissions into the displayed cache and do not mark an empty response as freshly checked.
- Show 'Access not yet confirmed' when no confirmed reading exists and distinguish last-confirmed timestamps from live readings.
- Leave curfew control and manual access priorities unchanged.

## 2.18.63 — 7 November 2026
- Reduce individual curfew scheduler checks from every 15 seconds to every 5 seconds.
- Reduce on-screen scheduler status polling from every 10 seconds to every 3 seconds.
- Preserve cloud confirmation and manual Keep indoors priority; actual cloud response latency remains outside app control.

## 2.18.62 — 7 November 2026
- Poll lightweight server curfew status every ten seconds and synchronise confirmed per-cat access with Home and pet profile displays.
- Show Updating access during scheduled transitions and the last confirmed check time.
- Keep the last confirmed cloud value visible while the next status is pending; do not label a requested command as confirmed.
- Preserve all curfew and manual access rules; no scheduler behaviour changes.

## 2.18.61 — 7 November 2026
- Persist a rolling history of individual curfew start, release, manual access and scheduler error events in the add-on data folder.
- Show read-only event history alongside curfew diagnostics for evidence-based troubleshooting.
- Keep existing access priority and automatic scheduler behaviour unchanged pending a verified release test.

## 2.18.60 — 7 November 2026
- Add read-only Individual curfew diagnostics panel showing each cat's schedule status, active phase, ownership, manual hold, observed cloud profile, last check and last error.
- Clarify that enabled individual curfews are live, not local preferences.
- No automated permission changes in this diagnostic release.

## 2.18.59 — 7 November 2026
- Keep ownership of automatic Indoor Only restriction until Sure Petcare confirms the automatic Free Access release; retry failed or unconfirmed releases.
- Record last scheduler check, observed profile, active phase, transition and errors for diagnosis.
- Preserve manual Keep indoors priority and never automatically release manual restrictions.

## 2.18.58 — 7 November 2026
- Fix root cause of individual curfew save failures: incorrectly escaped time-validation regular expressions in the server and web schedule normaliser rejected valid HH:mm values.
- Preserve existing schedules and manual access permissions; no automatic reset of cats.

## 2.18.57 — 7 November 2026
- Correct legacy individual curfew days without explicit enabled flags being treated as checked.
- Require an explicit checked day before its schedule is active; disable legacy equal-time days on load.
- Allow weekly curfew to be enabled first, then choose only the desired days.

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
