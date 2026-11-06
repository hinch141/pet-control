# Pet Control for Home Assistant Green

Home Assistant add-on repository for the Pet Control v2.4 interface.

## Install from your phone
1. In Home Assistant open **Settings → Apps → App store**.
2. Open the top-right menu, choose **Repositories**.
3. Add `https://github.com/hinch141/pet-control` and close the repository dialogue.
4. Refresh the app store, open **Pet Control** and select **Install**.
5. Select **Start**, then **Open Web UI** (via Home Assistant ingress).

This version is served through Home Assistant's authenticated ingress. It does not open a separate unauthenticated port on the local network.

## Current limits
The v2.4 interface is an offline prototype: its pet activity and settings are browser-local. It does **not** yet communicate with the Sure Petcare cat flap, provide a separate user-login system, or send real family invitations. Do not expose it directly to the public internet. Continue using Home Assistant's existing login and Nabu Casa remote access for access to this interface.

The installation should not require changes to existing Tailscale or Nabu Casa configuration.
