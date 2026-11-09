# Architecture

## DSH lifecycle

`package.json` declares a dual-side ESM plugin with `dsh.bundle.patch` and `dsh.client`. The patch mounts the Host row. `lib/index.js` registers a prefix HTTP handler and the optional `ai_radio` model tool using Cordis effects. The browser bundle uses `window.__ModuleLoader__`, with a compact input-dock view and a panel rendered through `shell.overlay`.

The text adapter calls the public DSH `llm.stream({ provider, model, system, messages, maxTokens, signal })` seam. Request-only user content is a typed text-block array. The plugin reads the configured provider/model catalog, not credential files or private conversation logs.

## Program pipeline

1. NetEase account login → playlist pagination → selected playlist tracks → unique authorized song library.
2. Local plays/skips/likes + NetEase weekly history → recency/artist candidate ranking.
3. Clock/timezone + cached Open-Meteo + fresh RSS + interests + optional user context → bounded AI call.
4. AI output is JSON parsed; song IDs must belong to candidates, duplicate and invented IDs are discarded, missing slots are filled deterministically.
5. Each program segment contains a real track and an optional typed speech unit. News speech includes actual source material; jokes have repeat avoidance. News consumption is acknowledged only after playback completes.
6. Browser preloads the next deck and speech; Web Audio schedules equal-power gain curves. A separate music bus handles ducking while speech plays. Gain scheduling continues independently of visual animation frames.
7. When the queue gets low, another batch is generated while current music continues. A stall watchdog and bounded exponential retry recover from failures. No fallback track is fabricated or silently substituted from another provider.

## State and isolation

`Store` writes a private state file using temporary-file plus rename. API responses remove API keys and never include the NetEase Cookie. Login changes clear the previous account's library/history. Configuration and playback records are local. Cross-tab Web Locks provide one active radio per origin on supported modern browsers.

RSS input is treated as untrusted text. Only today's timestamped items are eligible. Public RSS and media redirects are URL/domain/IP checked; media is restricted to recognized NetEase CDN domains. Custom model/TTS URLs are explicit user configuration and may point to a local service. Host writes require JSON; browser-origin requests must match the Host.

## Degradation

| Failure | Behavior |
|---|---|
| LLM unavailable/malformed JSON | Deterministic song selection and short template hosting |
| Weather unavailable | Omit weather; never speak stale cached conditions |
| RSS no timestamp/today content | Skip news; music continues |
| Cloud TTS unavailable | Attempt system speech; if unavailable, omit speech |
| Track trial/unavailable | Skip track, hold it out temporarily |
| Track URL expired | Resolve once more under the same account |
| All candidates fail | Exponential retry; clear status in UI |
| Browser blocks autoplay | Ask for the next explicit Play click |
| Unmount | Stop playback, remove timers/listeners/routes/tool |

## References

- DSH official `docs/subsystems/llm-streaming.md` and `packages/llm/llm/src/types.ts`, checked 2026-11-09.
- MIT dsh-music-player Host/client registration and NetEase/RSS modules, retrieved 2026-11-09.
- Claudio's typed song/TTS plans and Aurio's context-aware refill pipeline informed the design; see notices.
