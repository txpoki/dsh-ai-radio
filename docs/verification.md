# Verification record

Checked on **2026-11-09**, Asia/Shanghai. These results distinguish real public-service probes from simulated account/audio tests.

## 0.2.4 voice identity and configuration

- **67 unit/API/lifecycle tests passed**. Reproduced the prior behavior that cached Edge substitutes under Fish settings. The new code rejects that mismatch, reports a missing key before synthesis, preserves successful voice identity across cache restores, and never calls Edge as a substitute when Fish fails. Permanent authorization/quota errors do not retry every programme clip.
- **Three new real-browser checks passed** with generated audio: changing services while an old request was held could not play that old voice; missing Fish credentials were visible in settings and preview while music continued; selecting the free natural voice restored narration within the same music session. See [voice-report.json](voice-report.json).
- The existing **14 browser checks**, **two startup checks**, **three mixing checks**, and **three daily-source checks** also passed. Build and manifest/syntax checks passed.
- Fish request authentication, `model: s2.1-pro-free` and `reference_id` match the [official endpoint documentation](https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech). Fish synthesis and perceptual matching to a Studio voice were not tested with a personal Fish API key. HTTP failure cases use mock transport.
- Installed 0.2.4 through the native DSH plugin manager and restarted gracefully. With the free Xiaoyi voice selected, the live preparation endpoint reported `provider: edge`, `voice: zh-CN-XiaoyiNeural`, and a measured **11.496-second** MP3. The audio endpoint returned HTTP 200, `audio/mpeg`, **137,952 bytes**. The Fish preset remains configured for later use.
- The native Settings page showed the free Xiaoyi voice, and its preview was started using the actual Desktop control.

## 0.2.3 daily recommendations

- **63 unit/API/lifecycle tests passed**. New cases cover the authenticated daily endpoint, current/legacy response normalization, Shanghai-date caching, explicit refresh, empty/expired-login responses, concurrent request sharing, and rejecting a late response after logout.
- **Three daily-source browser checks passed**: a complete four-song synthetic recommendation episode reached actual HTMLAudio playback after its greeting and introduction; switching to a playlist restored the twelve-song fixture; a recommendation failure retained usable playlist controls and a fitting 430px mobile layout. Navigation remains the same three tabs. See [daily-report.json](daily-report.json) and [screenshot-library.png](screenshot-library.png).
- Re-ran the existing **14 browser checks**, **two startup checks**, and **three long-narration mixing checks** successfully. Build, manifest/syntax and whitespace checks passed.
- A live signed-in request to NetEase returned HTTP 200 and a nonempty recommendation list with song IDs, titles, artists, albums and durations. No personal track names, song IDs, account identifiers, Cookie or recommendation payload is included in this repository.
- Installed 0.2.3 through DSH Desktop's plugin manager and restarted gracefully. The live bootstrap returned 0.2.3; the daily-recommendation route returned today's date and a nonzero count while retaining the existing selected library. This was a read-only recommendation check; a new live-account AI programme was not generated.
- Confirmed the native Desktop Playlists page displays the current daily date/count and an enabled daily-radio start button. The existing playlist selection remains visible. Public screenshots use only the synthetic demo account.

## 0.2.2 continuous music scheduling

- **56 unit/API/lifecycle tests passed**. Coverage includes measured speech duration, persistent audio reuse, independently scheduled music/voice cues, and recalibration of an existing script or changed voice without repeating editorial generation.
- **14 browser checks passed**, crossing a full episode boundary with at least 24 music starts and 24 completed narration clips. Pause/resume, voice changes, a stalled track, dropped progress requests, cancellation and UI disposal were exercised with real HTMLAudio elements in installed Chrome.
- **Two startup checks passed**: the station bed begins during a pending model request, and pause/resume during preparation proceeds into the greeting and music automatically.
- **Three long-narration mixing checks passed** with eight-second generated tracks, a two-second crossfade and 3.5-second narration. All 420 sampled in-song voice instants had music; 237 samples contained both music decks. The incoming song continued beneath narration after the outgoing song ended. Music was already reduced before each segue voice onset, with more than 750ms of observed lead below the test threshold. Regular segues did not use the station bed. See [mix-report.json](mix-report.json).
- The actual previously synthesized Xiaoyi MP3 (135,936 bytes) was parsed successfully as MPEG 2 Layer 3 with a duration of **11.328 seconds**. The new episode preparation uses this metadata mechanism rather than estimating duration solely from text length.
- Build and manifest/syntax checks passed. These 0.2.2 checks use generated music and controlled model responses; they do not establish a live Desktop installation or a new real-account programme run for this version.

## 0.2.1 startup recovery

- **50 unit/API/lifecycle tests passed**. Reproduced a reasoning-only stream ending in max-tokens; it now raises a typed output-limit error. Verified capability-bound reasoning selection, increased retry budgets, and persisted chapter recovery after a simulated transport failure without repeating the director or completed chapters.
- **14 browser checks passed** with 24 track starts and 25 completed narration clips. A deliberately dropped progress request recovered automatically; disposing the UI did not send a backend cancellation.
- Two additional startup browser checks passed: station BGM began before a deliberately delayed model request returned, and pause/resume during preparation continued into the greeting, introduction and first actual HTMLAudio track.
- Individual web research has a deadline, including providers that ignore their cancellation signal. Drafts preserve already completed work; diagnostic progress contains counts and activity phases, never private reasoning text.

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
