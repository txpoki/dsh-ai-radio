# Verification record

Checked on **2026-11-09**, Asia/Shanghai. These results distinguish real public-service probes from simulated account/audio tests.

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
- Mounting in the user's currently running DSH Desktop profile. Host effect registration, stream request shape and browser ModuleLoader are covered by contract tests; the standalone browser fixture exercises the actual UI and engine.

These flows are implemented, with mocked upstream coverage. First-use configuration is documented in the README; no login Cookie or paid API Key was requested or embedded in the repository.
