# Verification record

Checked on **2026-11-09**, Asia/Shanghai. These results distinguish real public-service probes from simulated account/audio tests.

## 0.2.0 programme and voice revision

- **45 unit/API/lifecycle tests passed**. The whole-programme regression researches and scripts all 64 fixture songs before issuing playback batches, preserves their planned order, executes an AI follow-up query, and exports a full script. Cancellation and model failure cannot publish a partial programme as ready.
- Real installed Chrome, 1280×900 desktop and 430×932 mobile: **12 browser checks passed**, **24 actual HTMLAudio track starts**, **25 completed synthetic narration clips**, crossing a full episode boundary. AudioContext stayed running; no browser JavaScript errors. Stopping during delayed TTS preparation resolved immediately, and the delayed result could not restart the radio.
- The browser observed a greeting and first-song introduction completing over the station BGM before the first track started. Pause/resume during the greeting froze both voice and bed. During a later real audio narration, the music-bus gain measured **0.233** while voice gain was **1.0**, then music recovered smoothly above 0.8.
- Navigation contains exactly Listening / Playlists / Settings; no news or history page. The DSH font variable, voice changes, stall recovery, exclusive tab ownership and reload without autoplay were checked. The browser fixture uses generated WAV audio and demo metadata, not the listener's real music or a live model.
- **Real Edge neural speech probe succeeded**: zh-CN-XiaoyiNeural, 1.02×, +5Hz; returned 122,400 bytes of MP3 in about 2.5 seconds. Initial direct access timed out because Node did not inherit the active Windows system proxy; read-only proxy discovery fixed routing. One service response was HTTP 429; a later request succeeded. Synthesis is serialized and rate-limit failures have a cooldown. No system proxy setting was changed.
- Fish request model/reference/prosody and fallback behavior were verified with mock transport. The Blue Dafeiyu voice itself was not synthesized because no personal Fish key was supplied. No paid model-generation request was made for these fixture tests.
- The new default station bed is an original 48-second PCM composition; its format, duration and soft peak level were checked.
- Installed 0.2.0 through the actual DSH Desktop 2.0.18 plugin manager and restarted gracefully. The live bootstrap returned version 0.2.0, retaining the existing signed-in music account and 30-song library. Set the default to Edge Xiaoyi as requested; the installed plugin's real speech endpoint generated 135,936 bytes of MP3 and served it with HTTP 200. Fish voice configuration remains available; no personal login material is included in this record.

The following sections preserve the earlier release observations; their counts and dates describe those earlier runs.

## 0.1.1 activation regression

- **30 tests passed**, including a lifecycle test executed against the Cordis **4.0.5** bundled in the installed **DSH Desktop 2.0.18**, and three React rendering regressions for the closed overlay during loading/failure and explicit reconnection.
- Verified that the radio waits for the actual `webServer`, `llm`, `tools`, and `systemPrompt` services, enters the active state when they exist, and disposes its routes and tool cleanly.
- Fixed the 0.1.0 declaration that was incorrectly interpreted as services named `required` and `optional`. Earlier hand-written lifecycle mocks did not exercise this loader behavior.
- Installed the 0.1.1 archive through the actual DSH Desktop plugin manager. Enabling immediately after replacing 0.1.0 still reused the old host module; a complete, graceful app restart resolved it. The restarted profile inventory reported `enabled: true`, `fiberPhase: active`; `GET /dsh-ai-radio/bootstrap` returned HTTP 200 and version 0.1.1, and `/models` returned two providers with two models. No paid model generation or personal music login was performed.
- The initial browser endurance and public-service observations below apply to the unchanged player/context pipeline; this patch changes host dependency declaration and version metadata.

## Automated checks

- Build: DSH browser ModuleLoader bundle and standalone preview generated successfully.
- JavaScript syntax and DSH manifest: passed, 18 JavaScript files.
- Node unit/API/lifecycle tests: **26 passed, 0 failed**.
- Browser: real installed Chrome, headless, 1440×1020 desktop and 430×932 mobile.
- Browser endurance: **24 real HTMLAudio track transitions**, 17 completed synthetic speech clips, multiple automatic program refills. Final status playing; AudioContext running; no browser JavaScript errors.
- Actual simultaneous two-deck playback during scheduled crossfade: passed.
- Pause/resume position, host-setting changes while playing, stall watchdog, persisted history, cross-tab ownership, settings restore without autoplay: passed.
- Desktop/mobile screenshots inspected; mobile layout has no horizontal overflow.

The endurance fixture uses five-second **program-generated WAV audio** and synthetic speech tones. It exercises real media events, buffering, gain scheduling, queue replenishment and error handling. It is not a 24-hour reliability certification or an actual NetEase VIP listening test. The machine-readable browser result is [browser-report.json](browser-report.json).

## Real public-service probes

At 2026-11-09 14:34 Asia/Shanghai:

| Probe | Observed result |
|---|---|
| NetEase QR creation | Real interface returned a QR key and generated QR image |
| Open-Meteo | Shanghai weather successfully returned |
| News RSS sources | 121 timestamped current-day items after filtering and deduplication; six contributing sources; no failed sources in that run |

See [external-smoke.json](external-smoke.json). Weather values and news counts are observations at that time, not a guarantee about later requests.

## Not exercised with personal credentials

- Scanning and confirming the QR in the user's own NetEase App.
- Reading the user's private/account playlists and weekly history against a live signed-in account.
- Playback entitlement for the user's actual VIP/digital-album tracks.
- Paid DSH model generation or external OpenAI/Fish voice generation with the user's credentials.

These flows are implemented, with mocked upstream coverage. First-use configuration is documented in the README; no login Cookie or paid API Key was requested or embedded in the repository.
