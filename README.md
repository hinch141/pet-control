# Pet HQ — Home Assistant Green

This repository contains the live Pet HQ Home Assistant add-on and an **unreleased** standalone-access upgrade.

## Release safety
- The working Home Assistant installation is **v2.18.85**. Do not replace it with development code until a controlled upgrade is agreed.
- Stable code is preserved on `backup/pet-hq-v2.18.85-2026-11-07`.
- The experimental upgrade is on `development/pet-hq-standalone`, currently v2.18.86.
- The default branch is **not** the standalone upgrade. Adding this repository in the Home Assistant app store does not deploy the development branch.
- Never install a second active copy of Pet HQ: both copies would run curfew schedulers against the same flap.

## Planned standalone connection
- Cloudflare tunnel: `pet-hq` (healthy, no routes configured).
- Home Assistant Green LAN address: `192.168.1.11`.
- Planned Cloudflare published hostname: `hinchliffepethq.co.uk`.
- Planned tunnel service: `http://192.168.1.11:18080` (NOT Home Assistant port 8123).
- Internal add-on port 8080 maps to host port 18080.
- Cloudflare Access must authenticate the two approved household email addresses and be configured **before** publishing the hostname.
- The origin independently verifies Cloudflare Access JWT signatures, issuer, application audience, expiry and email allowlist. With incomplete settings, the standalone listener stays disabled.
- HA ingress on port 80 is retained for existing users.

## Controlled deployment prerequisites
1. Verify the full Home Assistant backup and add-on data backup are accessible.
2. Confirm that the selected update method replaces the **same add-on slug** `pet_control` and preserves `/data`, rather than starting a duplicate.
3. Set up the Cloudflare Access self-hosted application for `hinchliffepethq.co.uk` and capture its team domain and application AUD tag. Restrict access to the two household email addresses. Do not expose the public route yet.
4. Make sure the add-on's new configuration fields contain the team domain, AUD tag and comma-separated authorised emails. Preserve existing Sure Petcare credentials.
5. Deploy the verified v2.18.86 build via a controlled update path, and test existing HA ingress plus curfew state first.
6. Verify that the standalone port rejects requests without a valid Access JWT. A plain browser request to `http://192.168.1.11:18080` should be denied.
7. Only then publish the tunnel hostname to `http://192.168.1.11:18080` and test both household accounts and Android installation.
8. If anything fails, remove the Cloudflare published route first, then roll back the add-on and restore data if required.

## Testing limitations
GitHub Actions runs JavaScript syntax checks and unit/static tests. They do **not** establish a live connection to Home Assistant, Cloudflare, or the physical Sure Petcare flap. Those checks must be performed during the controlled deployment.
