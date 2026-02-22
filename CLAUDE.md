# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenClaw plugin that integrates Cloudflare Tunnel and Cloudflare Access. It spawns/manages a `cloudflared` process for tunnel mode and verifies Cloudflare Access JWTs to identify users. Published to npm as `openclaw-cloudflare`.

## Commands

- **Run all tests:** `npm test` (runs `vitest run`)
- **Run a single test file:** `npx vitest run src/tunnel/access.test.ts`
- **Run tests matching a name:** `npx vitest run -t "pattern"`
- **Typecheck:** `npm run typecheck` (runs `tsc --noEmit`)

## Architecture

ES module TypeScript project (`"type": "module"`) with no build/bundle step for development — the entry point is `./src/index.ts` directly.

### Module Layers

```
src/index.ts              Plugin interface — exports {id, name, register()}
                          register() receives OpenClaw API (logger, registerService, registerHttpHandler)
                          Validates config, wires service + HTTP handler

src/tunnel/exposure.ts    Orchestration — routes to correct mode (off / managed / access-only)
                          Returns a stop function or null

src/tunnel/cloudflared.ts Process management — finds/installs binary, spawns `cloudflared tunnel run`
                          Binary auto-install downloads from GitHub to ~/.openclaw/bin/
                          Passes token via TUNNEL_TOKEN env var (not CLI args)
                          Waits for connector registration on stderr, with timeout

src/tunnel/access.ts      JWT verification — JWKS fetching with 10min cache, RS256/ES256
                          Uses Node.js WebCrypto (no external crypto deps)
                          Returns {email} or null on failure (never throws)
```

### Plugin Registration Flow

1. `register(api)` validates config and exits early if mode is `"off"`
2. Registers a **service** (`cloudflare-tunnel`) that on `start()`:
   - Creates a JWT verifier if `teamDomain` is configured
   - Calls `startGatewayCloudflareExposure()` which spawns cloudflared in managed mode
3. Registers an **HTTP handler** that on every request:
   - Strips `x-openclaw-user-email` and `x-openclaw-auth-source` headers (anti-spoofing)
   - If verifier exists, reads `Cf-Access-Jwt-Assertion` header, verifies JWT, sets identity headers

### Key Design Patterns

- **Dependency injection everywhere** — logger, exec functions, fetch are all injected, making every module fully testable with mocks
- **Graceful degradation** — functions return null instead of throwing; errors are logged and the plugin continues
- **Anti-spoofing** — identity headers are always stripped before verification, then re-set only after successful JWT validation

## Configuration

Three modes configured via `tunnel.mode`:
- `"off"` (default) — plugin does nothing
- `"managed"` — spawns cloudflared, requires `tunnelToken` (config or `OPENCLAW_CLOUDFLARE_TUNNEL_TOKEN` env var)
- `"access-only"` — JWT verification only, expects external cloudflared

Config schema is defined in `openclaw.plugin.json`.

## Versioning and Releases

Uses [changesets](https://github.com/changesets/changesets). PRs to main require a changeset file (enforced by CI). Merging a changeset to main triggers automated npm publish via GitHub Actions with OIDC provenance.

**Every PR to main must include a changeset.** Add one with `npx changeset` or manually create a file in `.changeset/` with this format:

```md
---
"openclaw-cloudflare": patch  # or minor/major
---

Description of the change
```
