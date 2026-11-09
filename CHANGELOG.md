# Changelog

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
