# Pet HQ — Release checklist and development checkpoint

**Repository:** hinch141/pet-control  
**Release source:** `main` (never replace it wholesale with an older branch)  
**Protected reference:** `backup/pet-hq-v2.18.85-2026-11-07`  
**Existing development branch:** `development/pet-hq-standalone`  
**Current release at latest checklist update:** v2.18.110 (09/11/2026).

## Non-negotiable change procedure

1. Fetch and inspect the latest `main` files **before** editing; compare with the previous release and identify the exact functions/files to change.
2. Preserve all unrelated existing code and behaviour. Never copy an older full file over a newer release to fix one feature.
3. Make the smallest targeted change. Check the complete diff for unintended removals, stale literals and duplicated controls.
4. **MANDATORY:** Parse/compile-check every modified JavaScript file and inline HTML script before release. A syntax failure blocks release. Check the tests below against actual code paths. A source inspection is **not** an end-to-end test.
5. Keep `pet_control/config.yaml` version, visible app version, service-worker cache version and any other release labels consistent. Check there are no older hard-coded version labels in UI.
6. Check mobile/Android behaviour and service-worker caching. If Home Assistant or a real device is unavailable, clearly mark live checks as **not verified**.
7. Publish only after checks are complete. Provide a short list of changes and honest verification status, with a Home Assistant update link (not a commit link). Do not provide unready packages.
8. Maintain this checklist and a short checkpoint for each release, including remaining issues.

## Regression checks for every relevant release

- [ ] **Version:** Installed add-on version, displayed Pet HQ version and service-worker cache marker agree; no stale v2.18.99 UI text.
- [ ] **Active pets:** Jessie, Henry and Violet appear in active Home/Pets/live-status views. Rosie does **not** appear as active anywhere.
- [ ] **History:** Rosie’s historical movements and stored records are retained; never delete history just to hide an inactive pet.
- [ ] **Status:** Home pet cards, Home live-status and Home Recent activity use **In/Out**; the separate Timeline tab retains **Entered/Left**. States come from Sure Petcare/Home Assistant as appropriate; display the confirmed state, not an unconfirmed success.
- [ ] **Manual household access:** Keep all cats indoors overrides individual and whole-house curfews and persists until explicit Restore Free Access; incoming cats are not blocked.
- [ ] **Individual curfews:** Schedules survive whole-house changes and are not silently cleared. Review/confirmation popups clearly state the effect.
- [ ] **Curfew time inputs:** Changing a start time automatically displays and saves end time +1 minute, including midnight rollover; verify daily, weekly-copy and whole-house editors on Android.
- [ ] **Curfew execution:** Correct application and release of schedules; no stale lock after expiry; appropriate next-day handling for passed times.
- [ ] **Timeline:** Date picker and graph **To** date default to the current UK date, including after midnight when the app remains open; manually chosen historical ranges stay intact.
- [ ] **Graphs:** 7-day/28-day and custom ranges, per-pet filters, drill-down popups and CSV export still work. Date picker From and To cannot exceed today; To cannot precede From; changing From adjusts To as needed; same-day range is allowed.
- [ ] **Pet management:** Sync cats, archive/remove active pet, individual profile controls and photos do not regress.
- [ ] **Family access:** Equal permissions, email required for invitations, protect last active user; do not claim invitation emails were sent unless backend confirms.
- [ ] **Home Assistant/PWA:** HA integration, cloud status, mobile layout and existing standalone sign-in are preserved; avoid introducing an HA-login dependency for spouse.
- [ ] **Interface:** Simple pet cards, UK dates, In/Out language, clear wording; avoid unnecessary extra whole-house information cards.

## Current open items (not claimed fixed)

- Verify whole-house locking actually changes confirmed HA/Sure Petcare state and that manual override takes precedence over curfews.
- Review wording and confirmation buttons in whole-house popups.
- Verify +1-minute curfew updates end-to-end on Android.
- Verify v2.18.103 on the user's installed Home Assistant/mobile app, including visible version and Rosie removal.
- Verify graph To date after UK midnight with the app kept open.

- [ ] **Unconfirmed events:** Display **“Is looking outside”** experimentally when movement direction is unknown; do not infer a confirmed crossing or sensor-side location from that wording. Confirmed In/Out and Entered/Left labels remain unchanged.

- [ ] **Android calendar display:** Future dates are visibly disabled in the custom From/To activity calendar, not merely rejected after selection; To also disables dates before From. Confirm previous-month navigation, same-day range and graph rendering.

- [ ] **Date selection labels:** After choosing a date, From/To buttons show DD/MM/YYYY, not “Select date”. Verify changing From updates To if required, then Show dates renders the requested period.

- [ ] **First selection on Timeline:** Immediately after opening Timeline, select From once; date must persist through background graph refresh, then select To and Show dates. Test again after switching tabs and after 7/28-day preset.

## Release record

| Release | Summary | Verification |
| --- | --- | --- |
| 2.18.101 | Simplified whole-house controls UI | UI source changed; live control not verified |
| 2.18.102 | Refresh graph preset date when day changes | Source changed; phone not verified |
| 2.18.103 | Correct visible version literal and exclude Rosie from active Pets/live lists | Source changed; phone not verified |
| 2.18.104 | Home pet cards and Home Recent activity use In/Out; Timeline tab keeps Entered/Left | **FAILED:** JS syntax error disabled live status and graphs |
| 2.18.105 | Correct missing quote in live.js and validate JavaScript syntax | Syntax validated; phone retest pending |
| 2.18.106 | Experimental Is looking outside label for unconfirmed movement events | JavaScript syntax validated; user confirmed Henry timestamps match Sure Petcare |
| 2.18.107 | Restrict Timeline activity From/To dates to today and ordered range | User reported Android native picker still showed future dates selectable |
| 2.18.110 | Replace activity date inputs with controlled calendar that visibly disables invalid days | JavaScript syntax validated; Android visual retest pending |

**Important:** Never describe a code edit as a verified functional repair unless the relevant integration/device test has passed.

- **2.18.110 (09/11/2026):** Fixed calendar label formatter showing “Select date”; mock DOM date display tests and JavaScript syntax passed. Android verification pending.

- **2.18.110 (09/11/2026):** Preserve pending From/To date selections across asynchronous Timeline redraws. JavaScript syntax passed; Android first-selection retest pending.
