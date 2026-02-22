# openclaw-cloudflare

Cloudflare integration plugin for [OpenClaw](https://github.com/openclaw/openclaw). Provides Cloudflare Tunnel and Access support, with room for future Cloudflare features (Workers, R2, KV, etc.).

## Installation

```bash
openclaw plugins install openclaw-cloudflare
```

## Configuration

Add to your `openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "cloudflare": {
        "config": {
          "tunnel": {
            "mode": "managed",
            "tunnelToken": "your-tunnel-token",
            "teamDomain": "myteam",
            "audience": "optional-aud-tag"
          }
        }
      }
    }
  }
}
```

## Modes

### `off` (default)

Cloudflare integration is disabled.

### `managed`

OpenClaw spawns and manages a `cloudflared` tunnel process automatically.

**Requirements:**
- `cloudflared` binary installed and in PATH (or at a known location)
- A pre-configured tunnel token from the Cloudflare Zero Trust dashboard

**Setup:**

1. In the [Cloudflare Zero Trust dashboard](https://one.dash.cloudflare.com/), create a tunnel under **Networks > Tunnels**
2. Add a public hostname pointing to your OpenClaw gateway (e.g., `openclaw.example.com` → `http://localhost:3000`)
3. Create an Access Application under **Access > Applications** for the hostname
4. Copy the tunnel token and configure it:

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

Or via environment variable:

```bash
export OPENCLAW_CLOUDFLARE_TUNNEL_TOKEN="eyJhIjoiYWNj..."
```

### `access-only`

Use when `cloudflared` is managed externally (e.g., Docker sidecar, systemd service). The plugin only handles Cloudflare Access JWT verification.

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

## Authentication

When a request arrives with a `Cf-Access-Jwt-Assertion` header, the plugin:

1. Verifies the JWT signature against Cloudflare's JWKS endpoint (`https://<teamDomain>.cloudflareaccess.com/cdn-cgi/access/certs`)
2. Validates issuer, expiry, and audience (if configured)
3. Sets `x-openclaw-user-email` and `x-openclaw-auth-source` headers for downstream auth

Supported algorithms: RS256, ES256 (via Node.js WebCrypto).

JWKS keys are cached for 10 minutes with automatic refresh on key rotation.

## Configuration Reference

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `tunnel.mode` | `"off" \| "managed" \| "access-only"` | `"off"` | Operation mode |
| `tunnel.tunnelToken` | `string` | — | Tunnel token (managed mode) |
| `tunnel.teamDomain` | `string` | — | Team domain for `<team>.cloudflareaccess.com` |
| `tunnel.audience` | `string` | — | Optional AUD tag for stricter JWT validation |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENCLAW_CLOUDFLARE_TUNNEL_TOKEN` | Tunnel token (alternative to config) |
| `OPENCLAW_TEST_CLOUDFLARED_BINARY` | Override cloudflared binary path (testing) |
