# openclaw-cloudflare

Cloudflare integration plugin for [OpenClaw](https://github.com/openclaw/openclaw). Provides Cloudflare Tunnel and Access support, with room for future Cloudflare features (Workers, R2, KV, etc.).

## Setup Guide

### Step 1 — Install the plugin

```bash
openclaw plugins install openclaw-cloudflare
```

### Step 2 — Create a Cloudflare Tunnel

1. Go to the [Cloudflare Zero Trust dashboard](https://one.dash.cloudflare.com/) → **Networks > Tunnels**
2. Click **Create a tunnel** → choose **Cloudflared**
3. Name the tunnel (e.g. `openclaw`) and click **Save tunnel**
4. Skip the connector install step — the plugin handles this automatically
5. Under **Public Hostnames**, add a hostname pointing to your OpenClaw gateway:
   - Subdomain: `openclaw` (or whatever you prefer)
   - Domain: your domain (e.g. `example.com`)
   - Service: `HTTP` → `localhost:3000` (your OpenClaw port)
6. Copy the **Tunnel token** shown on the page (you'll need it in Step 4)

### Step 3 — (Optional) Set up Cloudflare Access

Skip this step if you only want the tunnel without user authentication.

1. In the Zero Trust dashboard → **Access > Applications** → **Add an application**
2. Choose **Self-hosted**
3. Set the **Application domain** to match the hostname from Step 2 (e.g. `openclaw.example.com`)
4. Configure the identity providers and policies (who is allowed to access)
5. Note your **Team domain** — visible at **Settings > Custom Pages** or in the URL: `https://<team>.cloudflareaccess.com`

### Step 4 — Configure the plugin

Add to your `openclaw.json`, using `cloudflare` as the plugin key:

```json
{
  "plugins": {
    "entries": {
      "cloudflare": {
        "config": {
          "tunnel": {
            "mode": "managed",
            "tunnelToken": "eyJhIjoiYWNj...",
            "teamDomain": "myteam"
          }
        }
      }
    }
  }
}
```

> **Important:** The config key must be `cloudflare` (the plugin ID), not `openclaw-cloudflare` (the npm package name).

Alternatively, set the token via environment variable instead of storing it in the config file:

```bash
export OPENCLAW_CLOUDFLARE_TUNNEL_TOKEN="eyJhIjoiYWNj..."
```

### Step 5 — Start OpenClaw

```bash
openclaw start
```

The plugin will:
- Automatically download `cloudflared` to `~/.openclaw/bin/` if not already installed
- Spawn the tunnel process and connect to Cloudflare's edge
- Verify Cloudflare Access JWTs on every incoming request (if `teamDomain` is set)

---

## Modes

### `off` (default)

Cloudflare integration is disabled.

### `managed`

OpenClaw spawns and manages a `cloudflared` tunnel process automatically. Requires `tunnelToken`.

> **Auto-install:** If `cloudflared` is not found in PATH or known locations, the plugin automatically downloads the latest release from GitHub to `~/.openclaw/bin/cloudflared`.

### `access-only`

Use when `cloudflared` is managed externally (e.g. Docker sidecar, systemd service). The plugin only handles Cloudflare Access JWT verification — no tunnel process is spawned.

```json
{
  "plugins": {
    "entries": {
      "cloudflare": {
        "config": {
          "tunnel": {
            "mode": "access-only",
            "teamDomain": "myteam",
            "audience": "aud-tag-from-access-app"
          }
        }
      }
    }
  }
}
```

**Docker Compose example** (external cloudflared):

```yaml
services:
  openclaw:
    image: openclaw:latest
    # ...

  cloudflared:
    image: cloudflare/cloudflared:latest
    command: tunnel run
    environment:
      TUNNEL_TOKEN: "eyJhIjoiYWNj..."
```

---

## Authentication

When `teamDomain` is configured, every request is checked for a `Cf-Access-Jwt-Assertion` header. The plugin:

1. Verifies the JWT signature against Cloudflare's JWKS endpoint (`https://<teamDomain>.cloudflareaccess.com/cdn-cgi/access/certs`)
2. Validates issuer, expiry, and audience (if `audience` is set)
3. Sets `x-openclaw-user-email` and `x-openclaw-auth-source: cloudflare-access` headers for downstream use

Supported algorithms: RS256, ES256 (via Node.js WebCrypto, no external deps). JWKS keys are cached for 10 minutes with automatic refresh on key rotation.

---

## Configuration Reference

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `tunnel.mode` | `"off" \| "managed" \| "access-only"` | `"off"` | Operation mode |
| `tunnel.tunnelToken` | `string` | — | Tunnel token from Cloudflare dashboard (managed mode) |
| `tunnel.teamDomain` | `string` | — | Team domain for `<team>.cloudflareaccess.com` |
| `tunnel.audience` | `string` | — | Optional AUD tag for stricter JWT validation |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENCLAW_CLOUDFLARE_TUNNEL_TOKEN` | Tunnel token (alternative to config file) |
| `OPENCLAW_TEST_CLOUDFLARED_BINARY` | Override cloudflared binary path (testing only) |
