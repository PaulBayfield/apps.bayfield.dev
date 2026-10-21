<div align="center">
  <img src="public/favicon.svg" alt="Apps Logo" width="120" />

  # Apps

  **A hub for my apps: public apps for everyone, and the private ones (behind Authentik) that each signed-in user can open. Built like my other apps.**

  [![License](https://img.shields.io/badge/license-AGPL%203.0-blue)](LICENSE)
  [![React](https://img.shields.io/badge/React-19-61DAFB)](https://react.dev)
  [![Node.js](https://img.shields.io/badge/Node.js-24-339933)](https://nodejs.org)
  [![Web](https://img.shields.io/badge/web-apps.bayfield.dev-brightgreen)](https://apps.bayfield.dev)
</div>


## ⚠️ • Disclaimer

This is a personal project built for my own use, not a polished product: expect missing pieces, sharp edges, and breaking changes.


## 📖 • Overview

- **Public apps** are listed in [`config/apps.json`](config/apps.json). Everyone sees them, signed in or not.
- **Private apps** come from Authentik. After signing in, the server asks Authentik which applications that user may open (the same policy check as Authentik's own library page), so each person only sees their own.
- **Account:** username, name, email and groups are shown read-only (an admin changes them in Authentik). The password can be changed here; that needs a sign-in less than 10 minutes old, otherwise Authentik asks for the password again first.
- **Two-factor authentication:** see your authenticator apps and passkeys, add new ones, remove old ones (removing also needs a recent sign-in).
- Same UI as [Calendar](https://github.com/PaulBayfield/calendar.bayfield.dev), [Notes](https://github.com/PaulBayfield/notes.bayfield.dev) and [DevTime](https://github.com/PaulBayfield/dev.bayfield.dev): header, resizable sidebar, right panel (filters / app details), the five themes, Ctrl+K palette, settings dialog, and the GitHub version check in Settings → About.
- Favorites (keys 1–9) and recently opened apps, saved on the device. English and French.
- No database: the session is an encrypted cookie (AES-256-GCM).


## 🚀 • Getting Started

```bash
npm install && npm --prefix server install
cp server/.env.example server/.env   # set SESSION_SECRET, and DEV_LOGIN_USER=demo to try it without Authentik
npm run server                       # API on :8791
npm run dev                          # web on http://localhost:1431
```

With `DEV_LOGIN_USER` (only honoured on `http://localhost`), sign-in skips Authentik and shows sample private apps.


## 🔐 • Authentik Setup

1. **Provider:** Applications → Providers → *OAuth2/OpenID*, confidential client, redirect URI `https://apps.bayfield.dev/api/auth/oidc/callback`, scopes `openid profile email`. Put its issuer, client ID and secret in `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`. Bind no policy to this application, so anyone can sign in to the hub.
2. **API token:** create a service account and give it these permissions (or make it a superuser): *view user*, *view user applications*, *reset user password*, and, for two-factor, *view* and *delete* on *TOTP Device* and *WebAuthn Device* (add *view* on *Static Device* to list recovery codes too). Create an API token for it (Directory → Tokens) and set it as `AUTHENTIK_TOKEN`.
3. **Private apps:** any Authentik application with a launch URL. Its policy bindings decide who sees it; its *group* becomes the category; its icon, description and publisher show on the card and in the details panel.

Notes:
- Users are matched by `preferred_username` (then email), so keep the default profile scope mapping.
- Passwords are set through the API, so Authentik's password policies (from your flows) don't run. The hub checks a minimum length (`PASSWORD_MIN_LENGTH`, default 8) and that the password isn't the username or email.
- App lists and profiles are cached for a minute; the refresh button in the toolbar asks Authentik again.

### Two-factor authentication

- **Adding** an authenticator app or a passkey happens in Authentik's own setup flows (`default-authenticator-totp-setup` and `default-authenticator-webauthn-setup`; change them with `AUTHENTIK_TOTP_FLOW` / `AUTHENTIK_WEBAUTHN_FLOW`). Authentik keeps the secrets, and passkeys have to be registered on its domain anyway. Authentik only returns to its own paths after a flow, so the hub passes its own OAuth authorize URL as `next`: once set up, the user (still signed in) bounces straight back to Settings → Two-factor. This needs `AUTHENTIK_URL` to be the same host as the issuer (the default).
- **Removing** one goes through the API and needs a sign-in less than 10 minutes old.
- **Making it mandatory** is Authentik's job: in your authentication flow's *Authenticator Validation* stage, set *Not configured action* to *Force the user to configure an authenticator* and select the TOTP and WebAuthn setup stages. Every user without 2FA then sets it up at their next sign-in.


## 🗂️ • Public Apps

`config/apps.json` is re-read whenever it changes, so no restart is needed:

```json
{
  "apps": [
    {
      "id": "website",
      "name": "bayfield.dev",
      "url": "https://bayfield.dev",
      "description": "My website.",
      "category": "Websites",
      "icon": "https://bayfield.dev/favicon.svg",
      "newTab": false
    }
  ]
}
```

`name` and `url` are required. If an Authentik app has the same URL, it's shown once, as public.


## ⌨️ • Keyboard Shortcuts

| Keys | Action |
| --- | --- |
| Ctrl+K or / | Search apps, categories, settings |
| 1–9 | Open favorite 1–9 |
| Ctrl+B or \\ | Toggle sidebar |
| . | Toggle details panel |
| Ctrl+, | Settings |
| Esc | Close / deselect |


## 🐳 • Docker Deployment

```bash
cp server/.env.example server/.env   # fill it in
docker compose up -d
```

The image listens on port 8791 and mounts `./config` so you can edit the public apps. `/api/health` answers for health checks. Pushing to `main` builds `ghcr.io/paulbayfield/apps.bayfield.dev` and publishes a GitHub release when `package.json`'s version changes, which is what Settings → About checks against.


## 📄 • License

[AGPL 3.0](LICENSE)
