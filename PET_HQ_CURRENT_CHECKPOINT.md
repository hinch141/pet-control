# Pet HQ — Current development checkpoint

**This file is the living handover record. Update it on `main` after each published release and at the end of each development session. Do not assume a version or task from an old conversation.**

## Current source of truth — checked 09/11/2026

- Repository: `hinch141/pet-control`
- Current release branch: `main`
- Version confirmed in `pet_control/config.yaml`: **2.18.106**
- Permanent release and regression rules: [PET_HQ_RELEASE_CHECKLIST.md](PET_HQ_RELEASE_CHECKLIST.md)
- Protected reference branch: `backup/pet-hq-v2.18.85-2026-11-07`
- Existing development branch: `development/pet-hq-standalone`
- Do **not** restore an older branch over `main`, create unnecessary branches, or replace complete working files for a narrow change.

## Last completed code changes

- **2.18.106 (09/11/2026):** User requested experimental display wording **“Is looking outside”** instead of **“Activity recorded”** for movement events whose direction is unconfirmed. Replaced only the three fallback display strings in `pet_control/web/live.js` (Home Recent activity, Timeline list and accessibility labels); confirmed In/Out and Entered/Left labels remain. No event classification, stored data or sensors were changed. `live.js` JavaScript parser check passed. Home Assistant/mobile display **not yet verified**. This wording is a user-selected interpretation, not proof of looking through the opening; review after observation.


- **2.18.106 (09/11/2026): CRITICAL FIX.** v2.18.104 introduced a JavaScript syntax error in `pet_control/web/live.js` during Home In/Out wording edits (missing closing quote in live-status row HTML). This stopped the script and caused Unknown status, empty activity and missing graphs. Corrected the quote and **validated the complete `live.js` with JavaScript parser (`new Function`) successfully**. No curfew or history logic changed. Bumped app-visible, add-on and service-worker versions. **User device retest still required.**
- **MANDATORY NEW GATE:** Run JavaScript syntax validation for every changed JS file and all inline JS in HTML **before publishing**, in addition to inspecting the diff. A documentation checklist alone does not prevent errors.

- **2.18.106 (09/11/2026):** Home pet cards and Home live-status labels now show **In/Out** instead of Home/Away; Home page Recent activity list now shows **In/Out**. The separate Timeline tab continues to use **Entered/Left**. Internal status values and history are unchanged. Updated the visible version, add-on version and service-worker cache marker. Source-code changes committed; **live Android/Home Assistant verification pending**.

- **2.18.101:** Simplified whole-house control UI; actual locking operation was **not** verified.
- **2.18.102:** Added automatic UK-day rollover for preset graph end date. Manually selected historical ranges should remain unchanged; phone verification pending.
- **2.18.103:** Corrected visible version literal (previously stuck at 2.18.99); removed Rosie from hard-coded active live-status list and filtered her from Pets tab. Historical records were not intentionally deleted.
- Added permanent `PET_HQ_RELEASE_CHECKLIST.md` to `main` for regression checks.
- Added this living checkpoint file; **documentation only**, no application release or version change.

## What the user has actually confirmed

- **09/11/2026 — user-verified observation:** Henry's **“Is looking outside”** event timestamps in Pet HQ align with the corresponding **“looked through the cat flap”** timestamps in the official Sure Petcare app. User considers the new wording a good change. This validates timestamp agreement for observed Henry events, **not** a general proof of sensor-side position or all event types. Preserve this wording unless new evidence or user feedback warrants a change.


- User supplied screenshots from v2.18.104 showing **Unknown** pet status, no activity and no Timeline graphs. Root cause identified as syntax error in `live.js`. Fixed in source v2.18.106; **not yet device-verified**.

- Earlier whole-house interface appearance looked acceptable, but popup wording may need changing.
- User subsequently reported that the app still displayed **2.18.99** and that Rosie remained in live status and Pets tab **before** the 2.18.103 source correction.
- **No confirmation yet** that 2.18.106 is installed on the user's Home Assistant/mobile app or that these two corrections display properly.
- Do not mistake source-code edits for live end-to-end verification.

## Completed wording change — 09/11/2026

- **Implemented in v2.18.106:** Pet cards and Home-page live status show **In/Out**; Home-page Recent activity rows show **In/Out**.
- **Intentionally unchanged:** The separate Timeline tab uses **Entered/Left**. Stored movement values, status mapping and historical records are unchanged.
- **Verification:** Code inspected and committed; phone/HA display not yet confirmed by user.

## Open issues and next agreed work

1. **First confirm installed version and visible app version (2.18.106)** against the actual latest `main` release; investigate stale app/service-worker cache if mismatched. Do not blindly bump versions.
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
