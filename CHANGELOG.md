# Changelog

## 0.2.4

- Never substitute a different voice when the selected Fish or compatible speech service is missing credentials or fails. Surface configuration, authentication, quota and voice errors while music continues.
- Reject earlier Edge substitutes cached under Fish settings. Preserve provider and voice identity in successful audio metadata, and recalibrate episode timing when the speech contract or credential changes.
- Cancel old narration and discard pending old voice cues when changing speech settings. Show missing-key guidance and the last used voice in Settings.
- Keep the free natural girl voice and the sourced Blue Dafeiyu preset. Clarify how a Fish Studio Model ID and API key are used by the plugin.

## 0.2.3

- Read the signed-in listener's NetEase daily song recommendations and expose a compact daily radio entry inside Playlists.
- Reuse whole-episode research, narration preparation and continuous playback for the daily source. Preserve playlist selections when switching sources.
- Cache by account and Shanghai calendar date, support manual refresh, and reload today's recommendations when starting a new day. Report expired login or an empty result explicitly; reject late responses after an account switch or logout.
- Add daily-source API, cache, account isolation and real-browser start/switch/error coverage.

## 0.2.2

- Pre-render the episode's narration, measure actual audio durations, and include song/voice cue times in the full script. Reuse synthesized audio from a bounded private disk cache across restarts.
- Schedule music and narration independently: the next song crossfades on time while the host spans the outgoing tail and incoming intro, eliminating voice-only gaps at normal song boundaries.
- Duck music about 1.2 seconds before the voice starts and smoothly restore it afterward. Calibrate cues from actual media duration during playback.
- Add a real-browser long-narration regression that samples both music decks and verifies continuity, overlapping songs, and pre-duck lead time.

## 0.2.1

- Detect thinking/output budget exhaustion explicitly, use capability-bound reasoning controls, and retry with a larger budget instead of treating truncated text as a complete programme.
- Persist the director brief, follow-up searches and each eight-song script chapter; retries resume completed work.
- Show model thinking/writing activity and elapsed preparation time. Play soft station BGM during preparation, with working pause/resume.
- Recover dropped progress requests automatically, retain backend preparation across UI disposal, and avoid restarting the same in-flight playlist.
- Bound individual research calls and parallelize follow-up checks; add budget, checkpoint, network recovery and startup regressions.

## 0.2.0

- Prepare a whole-playlist episode before broadcast: per-song web research, AI editorial direction, follow-up searches, global ordering, chapter scripts, a standalone greeting, and a downloadable full script with references.
- Introduce the energetic whale-girl host Xiao Jing, natural Edge neural speech by default, and a sourced Fish Audio Blue Dafeiyu preset. Serialize synthesis, respect the existing Windows proxy, and avoid silent robotic-voice fallback.
- Rebuild the interface with DSH font tokens and blue/white controls; retain only Listening, Playlists and Settings.
- Narrate over outgoing music and an original soft station bed before starting each incoming track, with smooth music ducking and recovery.
- Keep episodes continuous across cycles, preserve pause/resume during speech, and remove stale or heard news from reused scripts.
- Add whole-programme, cancellation, provenance, voice migration, provider, proxy and audio regression coverage.

## 0.1.1

- Fix DSH activation hanging with `pending (waiting for services: required, optional)`: declare dependencies using Cordis's supported service-name array.
- Add a real Cordis-loader lifecycle test, including delayed service availability, activation and cleanup. The test can run against the runtime bundled with the installed DSH Desktop.
- Keep a closed radio overlay unmounted during startup or connection failure, so it cannot cover DSH's toolbar or block plugin management.
- Document Desktop's built-in installation flow and the complete app restart required to replace a cached 0.1.0 host module; verify activation and live routes in the installed Desktop profile.

## 0.1.0

- Initial personal AI radio implementation.
