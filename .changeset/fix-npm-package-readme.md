---
"openclaw-cloudflare": minor
---

Remove managed mode — plugin now focuses solely on Cloudflare Access JWT verification. Assumes cloudflared is managed externally. Config is now flat (teamDomain, audience) with no tunnel wrapper or mode field.
