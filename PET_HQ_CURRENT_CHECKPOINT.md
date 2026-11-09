# Pet HQ — Current development checkpoint

**This file is the living handover record. Update it on `main` after each published release and at the end of each development session. Do not assume a version or task from an old conversation.**

## Current source of truth — checked 09/11/2026

- Repository: `hinch141/pet-control`
- Current release branch: `main`
- Version confirmed in `pet_control/config.yaml`: **2.18.119**
- Permanent release and regression rules: [PET_HQ_RELEASE_CHECKLIST.md](PET_HQ_RELEASE_CHECKLIST.md)
- Protected reference branch: `backup/pet-hq-v2.18.85-2026-11-07`
- Existing development branch: `development/pet-hq-standalone`
- Do **not** restore an older branch over `main`, create unnecessary branches, or replace complete working files for a narrow change.

## Latest UI trial — 2.18.119 (09/11/2026)

- Protected rollback branch: `backup/pet-hq-v2.18.118-before-card-refresh` (snapshot of original main).
- Read-only badge added to each home pet card based on the existing confirmed Sure Petcare access state: Keep indoors, Free access, or Access not confirmed; a configured curfew is indicated when the local pet schedule is enabled. Kept existing Access, Curfew & times, Movements, and detailed-settings buttons and all access/curfew handlers unchanged.
- Red gradient header, lighter page background, blue raised access buttons. No backend changes. Release needs real-device visual and access-status validation; do not assume a badge proves which mechanism caused a restriction.

## Last completed code changes

- **2.18.115 (09/11/2026): PET ARCHIVE PILOT.** Added `/pet-hq/archive` GET/POST endpoints with durable atomic `/data/pet-hq-archived-pets.json` registry (Sure Petcare ID, name, profile snapshot, local sample events, archived timestamp). Archive/Restore in Pets now calls backend first, then changes local state only on success. Sync Pets loads server registry and excludes archived Sure IDs, preventing automatic re-add. Archived status is reapplied to locally known pets when syncing. No Sure Petcare delete or flap/curfew API change. All JS source and inline script syntax passed. **Not yet tested on live HA or with real Sure IDs.** IMPORTANT: browser-local event history is not a full Sure Petcare cloud archive; the existing server activity cache is independent. Need live test using a noncritical linked cat, then verify sync suppression and restore. Server /data persists across add-on updates but should be included in HA backups; fresh installation without restoring /data loses the registry. Local pet profiles on other browsers are not yet fully replicated.


- **2.18.114 (09/11/2026):** User found that deleting saved multiple whole-house curfew time ranges during Enable setup had no way to save removals without enabling. Added **Save times only** to setup popup. This posts existing backend `save` action with edited ranges and keeps whole-house curfew off; **Set curfew** continues to post `enable` and activates. Both paths use existing time validation and past-time warning. No backend scheduler changes. `live.js` syntax checked; phone verification pending. At least one range must remain, as existing backend requires 1–12.


- **2.18.113 (09/11/2026):** User confirmed v2.18.112 whole-house curfew setup works. Removed redundant **View or edit times** button: the **Enable** switch alone opens time-range setup, with a short explanation that active times require disabling first; saved ranges remain. No curfew backend or timing changes. Inline JavaScript syntax checked; phone UI verification pending.
- **Next agreed design (not implemented):** Pet HQ removal must archive pet and preserve all existing historical records, leave Sure Petcare registration untouched, and suppress re-import on subsequent Sync Pets using stable Sure Petcare pet ID; plan explicit restore later. Family users all equal full access; add/remove with email invitation and one-time sign-in, without HA login. Investigate existing authentication/hosting and data retention before coding invitations. User does not want permission levels.


- **2.18.112 (09/11/2026):** Whole-house curfew Enable now opens the existing multi-range time editor (up to 12 daily ranges) **before** activation. Confirm **Set curfew** submits the `enable` action with selected ranges in one request; Cancel leaves curfew off. Existing disabled-curfew editor now uses **Save changes** (save-only). Updated wording: **Set curfew for all cats**, **Stay indoors from**, **Until**, **Add another time range**, and explanation that cats can always enter. Start time still auto-sets end +1 minute; overnight ranges supported. Preserve draft and action when returning from already-passed-time warning. Whole-house Indoor Only confirmation now uses **Set all cats to Indoor Only?** / **Restore normal access for all cats?**, with specific buttons and explanation that individual settings remain. Curfew disable confirmation explains that stored times are kept. No backend schedule/locking algorithm changed. JS syntax checks passed for live.js and all inline scripts; Home Assistant/mobile functional tests **pending**. Editing an *enabled* whole-house curfew still requires switching it off first because the existing backend rejects range changes while active.


- **2.18.112 (09/11/2026):** User confirmed first From date selection still disappears on Android in 2.18.110. Root cause identified in controlled calendar: on opening it captured references to hidden date inputs, but async Timeline graph redraw can replace those DOM elements before day tap. Date click then updates detached input and not visible button. Fix: resolve live `graph-from`/`graph-to` elements at day-click time, then persist pending selections and update current labels. JS syntax check passed; first-selection on Android **pending verification**.


- **2.18.112 (09/11/2026):** User reports first selection of From date on initial Timeline open is lost and must be repeated. Likely cause: async graph refresh re-renders the date controls from committed graphStart/graphEnd, discarding unsaved selected dates. Added `pendingGraphFrom` and `pendingGraphTo` to persist date picks across redraws; clear on Show dates or 7/28-day preset. JavaScript syntax checked. Actual Android first-selection regression test **pending**; no graph calculations or curfew schedules changed.


- **2.18.112 (09/11/2026):** User screenshot showed **“Select date”** on From/To after selecting dates in v2.18.108. Root cause: calendar label formatter used incorrectly escaped regex (`/\\\\d/` instead of `/\\d/`), so valid ISO dates failed its check. Replaced fragile regex with explicit ISO date separator/length check. Tested label rendering with mock DOM for 01/11/2026, 09/11/2026 and 25/10/2026; passed. Full live.js JavaScript syntax check passed. Android device verification pending. No graph or curfew logic changed.


- **2.18.112 (09/11/2026):** User confirmed native Android date dialog in v2.18.107 still visually allowed future days even though selection was rejected. Replaced the Timeline graph From/To native date widgets with a controlled, UK-formatted calendar popup that visibly disables dates after today and, for To, dates before From. Retained graph range validation, 90-day maximum and historical records. `live.js` passed JavaScript parser check; Android visual/function verification **pending**. No curfew schedule logic changed.


- **2.18.112 (09/11/2026):** Timeline tab activity graphs **From/To** date filters: both dates max at current UK date; To date min follows From date; changing From automatically raises To if necessary, and changing To clamps it within From–today. Existing same-day selection remains allowed; 90-day range limit unchanged. This is **not a curfew scheduling change**. Full `live.js` JavaScript syntax check passed; real Android calendar widget behaviour not yet tested. Visible/add-on/service-worker versions updated.


- **2.18.112 (09/11/2026):** User requested experimental display wording **“Is looking outside”** instead of **“Activity recorded”** for movement events whose direction is unconfirmed. Replaced only the three fallback display strings in `pet_control/web/live.js` (Home Recent activity, Timeline list and accessibility labels); confirmed In/Out and Entered/Left labels remain. No event classification, stored data or sensors were changed. `live.js` JavaScript parser check passed. Home Assistant/mobile display **not yet verified**. This wording is a user-selected interpretation, not proof of looking through the opening; review after observation.


- **2.18.112 (09/11/2026): CRITICAL FIX.** v2.18.104 introduced a JavaScript syntax error in `pet_control/web/live.js` during Home In/Out wording edits (missing closing quote in live-status row HTML). This stopped the script and caused Unknown status, empty activity and missing graphs. Corrected the quote and **validated the complete `live.js` with JavaScript parser (`new Function`) successfully**. No curfew or history logic changed. Bumped app-visible, add-on and service-worker versions. **User device retest still required.**
- **MANDATORY NEW GATE:** Run JavaScript syntax validation for every changed JS file and all inline JS in HTML **before publishing**, in addition to inspecting the diff. A documentation checklist alone does not prevent errors.

- **2.18.112 (09/11/2026):** Home pet cards and Home live-status labels now show **In/Out** instead of Home/Away; Home page Recent activity list now shows **In/Out**. The separate Timeline tab continues to use **Entered/Left**. Internal status values and history are unchanged. Updated the visible version, add-on version and service-worker cache marker. Source-code changes committed; **live Android/Home Assistant verification pending**.

- **2.18.101:** Simplified whole-house control UI; actual locking operation was **not** verified.
- **2.18.102:** Added automatic UK-day rollover for preset graph end date. Manually selected historical ranges should remain unchanged; phone verification pending.
- **2.18.103:** Corrected visible version literal (previously stuck at 2.18.99); removed Rosie from hard-coded active live-status list and filtered her from Pets tab. Historical records were not intentionally deleted.
- Added permanent `PET_HQ_RELEASE_CHECKLIST.md` to `main` for regression checks.
- Added this living checkpoint file; **documentation only**, no application release or version change.

## What the user has actually confirmed

- **09/11/2026 — user verified v2.18.114:** Whole-house curfew **Save times only** successfully saves removal of unwanted time ranges without enabling the curfew. User explicitly confirmed **“that works”** and authorised moving to pet management. Mark this behaviour as working; retain the implementation.


- **09/11/2026 — user confirmed v2.18.112 fix works on Android:** Selecting a From date on the first attempt when Timeline opens now retains and displays the selected date. The detached-input/calendar-redraw correction is verified by the user. No further change required.


- **09/11/2026 — user-verified observation:** Henry's **“Is looking outside”** event timestamps in Pet HQ align with the corresponding **“looked through the cat flap”** timestamps in the official Sure Petcare app. User considers the new wording a good change. This validates timestamp agreement for observed Henry events, **not** a general proof of sensor-side position or all event types. Preserve this wording unless new evidence or user feedback warrants a change.


- User supplied screenshots from v2.18.104 showing **Unknown** pet status, no activity and no Timeline graphs. Root cause identified as syntax error in `live.js`. Fixed in source v2.18.112; **not yet device-verified**.

- Earlier whole-house interface appearance looked acceptable, but popup wording may need changing.
- User subsequently reported that the app still displayed **2.18.99** and that Rosie remained in live status and Pets tab **before** the 2.18.103 source correction.
- **No confirmation yet** that 2.18.112 is installed on the user's Home Assistant/mobile app or that these two corrections display properly.
- Do not mistake source-code edits for live end-to-end verification.

## Completed wording change — 09/11/2026

- **Implemented in v2.18.112:** Pet cards and Home-page live status show **In/Out**; Home-page Recent activity rows show **In/Out**.
- **Intentionally unchanged:** The separate Timeline tab uses **Entered/Left**. Stored movement values, status mapping and historical records are unchanged.
- **Verification:** Code inspected and committed; phone/HA display not yet confirmed by user.

## Open issues and next agreed work

1. **First confirm installed version and visible app version (2.18.112)** against the actual latest `main` release; investigate stale app/service-worker cache if mismatched. Do not blindly bump versions.
2. **Confirm Rosie is absent from active Home, Pets and live-status views**, while her historical movement records remain available.
3. **Review whole-house popup wording and confirmation buttons** with the user, preserving manual override and individual-curfew rules.
4. **Investigate and verify whole-house Keep Indoors behaviour** through actual HA/Sure Petcare integration. UI simplification alone did not prove functionality.
5. **Verify +1-minute end-time adjustment** in individual daily, weekly and whole-house curfew editors, including saving, reloading, Android picker events and midnight rollover.
6. **Verify timeline and graph To date default to today's UK date**, including when the app remains open across midnight.
7. Keep standalone PWA access for spouse independent of repeated Home Assistant login; do not disrupt existing authentication or integrations.

These are outstanding verification/work items, **not** instructions to change all these features at once. The next task should follow the user's most recent request.

## Invariants to preserve

- Active pets Jessie, Henry, Violet; Rosie no longer active but historical records retained.
- Live In/Out status, pet photos/profiles, movement timeline, 7/28-day graphs, filters and CSV export.
- Manual **Keep Indoors** overrides scheduled curfews and remains until explicit **Restore Free Access**; incoming cats must still be allowed.
- Individual curfews are preserved when whole-house controls change; review popup before any proposed clearing.
- Start-time changes should set end time exactly +1 minute, including across midnight; verify UI, saved data and actual execution.
- Existing Sure Petcare, Home Assistant, HACS, standalone PWA, family-user and security architecture.
- Simple Android-friendly interface, UK dates and In/Out terminology.

## Mandatory handover procedure

**Before editing:** Read this checkpoint, the release checklist and the actual latest `main` code. Identify the precise requested change and compare with the existing implementation.

**Before publishing:** Inspect the diff, check for regressions, confirm all version identifiers agree, and distinguish source inspection from actual HA/mobile testing. Do not alter unrelated working functions.

**After each release or completed session:** Update this file with (a) actual version from `config.yaml`, (b) exact completed changes, (c) what was genuinely tested, (d) user-reported results, (e) remaining issues, and (f) the next agreed task. Commit the updated checkpoint to `main` even when only documentation changes. Keep this file current; remove stale claims rather than accumulating contradictory status notes.

**New-chat handover:** “Continue Pet HQ from the latest GitHub `main`. Read `PET_HQ_RELEASE_CHECKLIST.md` and `PET_HQ_CURRENT_CHECKPOINT.md`, verify the latest version, and resume the recorded next task without rebuilding or regressing existing features.”

- **09/11/2026 — user verified v2.18.115:** Archive, Sync Pets exclusion and Restore tested successfully by user with a living cat. Preserve this behaviour. Sure Petcare remains registered; long-term independent history backup and cross-device state are not yet verified.

- **2.18.116 (09/11/2026):** User noticed archived cats still appeared in **Live Sure Petcare status** card. `web/live.js` status card now filters its fixed name list against `activePets()` so archived cats disappear from the card, while live cloud data and historical timeline are unchanged. JS syntax checked; user verification pending.

- **09/11/2026 — user confirmed v2.18.116 live status:** Archiving a cat correctly removes it from the Live Sure Petcare status card; user said “that works now”. Preserve this behaviour in future releases.

- **09/11/2026 v2.18.117 FAMILY ACCESS PILOT:** Added persistent `/data/pet-hq-family.json` household list; standalone Cloudflare JWT verification now checks membership on every request, including immediate server-side revocation. Initial authorised emails from `access_emails` are imported as protected founding members, retaining current access. New `GET/POST /pet-hq/family` endpoints require verified standalone email, never exposed through HA ingress. Family screen now lists actual server members, adds/removes full-access accounts, opens a mailto invitation composer. **Cloudflare Access policy is separate and is NOT automatically edited; newly added email must be permitted by Cloudflare policy before sign-in. Email is not sent automatically.** No live HA/Cloudflare test yet. Test existing accounts first, then add a disposable test email and update Cloudflare policy before sign-in; remove and verify 403 on subsequent requests. Preserve existing pet archive and curfews.

- **09/11/2026 v2.18.118:** User screenshot showed imported protected family names `hinchi1` and `nicky.hinchliffe`. Added migration to display **John** and **Nicky** for their exact verified primary email addresses without changing account authorisation or existing data. Removed obsolete device-local/demo security explanation; replaced with accurate Cloudflare policy caveat. Syntax checked; user display verification pending.

- **09/11/2026 — user confirmed v2.18.118:** Primary family display names John and Nicky now show correctly. Next test: add an additional email, confirm Cloudflare policy permits sign-in, then remove and verify Pet HQ server denies subsequent requests. No further code changes yet.
