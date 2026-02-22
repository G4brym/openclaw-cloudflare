# openclaw-cloudflare

Cloudflare Access JWT verification plugin for [OpenClaw](https://github.com/openclaw/openclaw). Verifies `Cf-Access-Jwt-Assertion` headers and sets identity headers for authenticated requests.

Assumes `cloudflared` is already running externally (Docker sidecar, systemd, Cloudflare's own connector, etc.).

## Setup Guide

### Step 1 — Install the plugin

```bash
openclaw plugins install openclaw-cloudflare
```

### Step 2 — Set up Cloudflare Access

1. In the [Cloudflare Zero Trust dashboard](https://one.dash.cloudflare.com/) → **Access > Applications** → **Add an application**
2. Choose **Self-hosted**
3. Set the **Application domain** to the hostname pointing at your OpenClaw gateway (e.g. `openclaw.example.com`)
4. Configure the identity providers and policies (who is allowed to access)
5. Note your **Team domain** — visible at **Settings > Custom Pages** or in the URL: `https://<team>.cloudflareaccess.com`

### Step 3 — Configure the plugin

Add to your `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "cloudflare": {
        "config": {
          "teamDomain": "myteam"
        }
      }
    }
  }
}
```

> **Note:** The config key must be `cloudflare` (the plugin ID), not `openclaw-cloudflare` (the npm package name).

### Step 4 — Start OpenClaw

```bash
openclaw gateway --force
```

The plugin will verify Cloudflare Access JWTs on every incoming request and set `x-openclaw-user-email` for authenticated users.

---

## How it works

When a request arrives with a `Cf-Access-Jwt-Assertion` header, the plugin:

1. Verifies the JWT signature against Cloudflare's JWKS endpoint (`https://<teamDomain>.cloudflareaccess.com/cdn-cgi/access/certs`)
2. Validates issuer, expiry, and audience (if `audience` is configured)
3. Sets `x-openclaw-user-email` and `x-openclaw-auth-source: cloudflare-access` headers for downstream use

Identity headers are always stripped from incoming requests before verification to prevent spoofing.

Supported algorithms: RS256, ES256 (via Node.js WebCrypto, no external deps). JWKS keys are cached for 10 minutes with automatic refresh on key rotation.

---

## Configuration Reference

| Key | Type | Description |
|-----|------|-------------|
| `teamDomain` | `string` | Team domain for `<team>.cloudflareaccess.com` (required) |
| `audience` | `string` | Optional AUD tag for stricter JWT validation |

