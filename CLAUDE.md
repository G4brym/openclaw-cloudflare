# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenClaw plugin that verifies Cloudflare Access JWTs to identify users. Published to npm as `openclaw-cloudflare`. Assumes `cloudflared` is managed externally — this plugin handles only JWT verification.

## Commands

- **Run all tests:** `npm test` (runs `vitest run`)
- **Run a single test file:** `npx vitest run src/tunnel/access.test.ts`
- **Run tests matching a name:** `npx vitest run -t "pattern"`
- **Typecheck:** `npm run typecheck` (runs `tsc --noEmit`)

## Architecture

ES module TypeScript project (`"type": "module"`) with no build/bundle step — the entry point is `./src/index.ts` directly.

### Module Layers

```
src/index.ts          Plugin interface — exports {id, name, register()}
                      register() receives OpenClaw API (logger, registerHttpHandler)
                      Creates JWT verifier if teamDomain is configured, registers HTTP handler

src/tunnel/access.ts  JWT verification — JWKS fetching with 10min cache, RS256/ES256
                      Uses Node.js WebCrypto (no external crypto deps)
                      Returns {email} or null on failure (never throws)
```

### Plugin Registration Flow

1. `register(api)` checks for `teamDomain` — warns and exits early if absent
2. Creates a JWT verifier eagerly
3. Registers an **HTTP handler** that on every request:
   - Strips `x-openclaw-user-email` and `x-openclaw-auth-source` headers (anti-spoofing)
   - Reads `Cf-Access-Jwt-Assertion` header, verifies JWT, sets identity headers on success

### Key Design Patterns

- **Dependency injection** — fetch is injected into the verifier, making it fully testable with mocks
- **Graceful degradation** — verifier returns null instead of throwing; errors are logged and the request continues
- **Anti-spoofing** — identity headers are always stripped before verification, then re-set only after successful JWT validation

## Configuration

Plugin activates when `teamDomain` is set in config (flat structure, no nesting):

```json
{
  "plugins": {
    "entries": {
      "openclaw-cloudflare": {
        "config": {
          "access": {
            "teamDomain": "myteam",
            "audience": "optional-aud-tag"
          }
        }
      }
    }
  }
}
```

Config schema is defined in `openclaw.plugin.json`.

## Workflow

The `main` branch is protected. All code changes must go through a pull request — never commit directly to main.

## Versioning and Releases

Uses [changesets](https://github.com/changesets/changesets). PRs to main require a changeset file (enforced by CI). Merging a changeset to main triggers automated npm publish via GitHub Actions with OIDC provenance.

**Every PR to main must include a changeset.** Add one with `npx changeset` or manually create a file in `.changeset/` with this format:

```md
---
"openclaw-cloudflare": patch  # or minor/major
---

Description of the change
```
