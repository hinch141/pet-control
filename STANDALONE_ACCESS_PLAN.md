# Pet HQ standalone access — implementation plan

Status: design only; no standalone endpoint deployed. Original v2.18.85 is unchanged.

## Verified baseline
- `pet_control/config.yaml`: Home Assistant Ingress enabled on internal port 80; no host port published.
- `pet_control/server.js`: only accepts requests from Home Assistant ingress proxy `172.30.32.2`; uses `SUPERVISOR_TOKEN` for Home Assistant API.
- Existing curfew schedulers run inside the add-on process and write files under `/data`.
- Cloudflare Tunnel is healthy on Home Assistant Green, but no public route exists yet.

## Safety constraints
1. Never publish port 8123 as the Pet HQ standalone app.
2. Never remove the ingress-only peer check from the live version or trust arbitrary forwarded identity headers.
3. Never run two independently active copies of curfew schedulers against the same cat flap: parallel instances could issue conflicting lock/unlock commands.
4. Protect both reads and writes with authentication; allow only approved household accounts. Cloudflare Access email OTP can gate access, but origin-side protection must be designed to avoid bypass.
5. Preserve curfew ownership and individual-pet precedence; test before any deployment.
6. Preserve existing `/data` files and Home Assistant backup; avoid sharing Sure Petcare credentials or tunnel tokens in GitHub.

## Implementation sequence
1. Audit existing routes, state and scheduling dependencies.
2. Choose a **single authoritative scheduler** design: either a carefully migrated replacement add-on with ingress plus separately authenticated endpoint, or a lightweight gateway to the one live scheduler. No simultaneous active duplicate schedulers.
3. Implement standalone endpoint and authentication on this development branch only.
4. Add automated checks for unauthorised access, manual overrides, curfew precedence, overnight times, and scheduler single-writer behaviour.
5. Package an isolated test install; do not deploy before tests.
6. Configure Cloudflare Access allow-list and published route for `hinchliffepethq.co.uk` only after an authenticated origin endpoint is ready.
7. Verify Android PWA access for both household users, then plan controlled migration.

## Decisions still requiring implementation evidence
- Whether a Home Assistant Green add-on can safely expose a second listener while retaining ingress and protecting origin access.
- Whether a gateway can reuse ingress without forwarding a Home Assistant session cookie.
- How to ensure the Cloudflare Access identity is verified at origin and that unauthorised LAN requests cannot bypass it.
