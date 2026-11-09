# Source acknowledgments

The following files are adapted from [kendu76/dsh-music-player](https://github.com/kendu76/dsh-music-player), MIT, copyright (c) 2026 kendu76:

- `lib/vendor/netease.js`: NetEase login, encrypted API calls and playlist reading. Import path adjusted; the radio's authorized stream resolution and listening-history extension live separately in `lib/music.js`.
- `lib/vendor/news-core.js` and `calendar.js`: RSS parsing, default feed catalog and title deduplication helpers.
- `lib/vendor/qrcode.mjs`: upstream embedded qrcode-generator (Kazuhiko Arase, MIT; license retained in file).

The full upstream MIT notice is retained at `lib/vendor/LICENSE.dsh-music-player`.

Design and code studies: [Claudio](https://github.com/hllqkb/Claudio), MIT, for typed music/speech playback plans and context assembly; [Aurio](https://github.com/baogutang/aurio), MIT, for contextual DJ persona and automatic queue refilling; [XRadio](https://github.com/ibrahimirdem/xradio), MIT, for talk/music ducking. No code from these three projects is copied into this repository.

Music is streamed using the listener's own NetEase account permissions. This plugin does not unlock unavailable tracks or redistribute a music library. The MIT license covers this software, not third-party music, API services, or voice rights.

Version 0.2 uses [node-edge-tts](https://github.com/SchneeHertz/node-edge-tts), MIT, as a declared runtime dependency; its distributed license accompanies the npm package. Version 0.2.2 also uses [music-metadata](https://github.com/Borewit/music-metadata), MIT, to measure synthesized audio duration. No code from the GPL-licensed Python edge-tts or the GPL-licensed dafeiyu-ai-vtuber is copied here.

The public Blue Dafeiyu reference ID and model preset were identified in [zbsdsb/dafeiyu-ai-vtuber/config.json](https://github.com/zbsdsb/dafeiyu-ai-vtuber/blob/dafeiyu/config.json). This is configuration interoperability, not a redistribution of voice weights, reference recordings, character artwork, or that project's implementation. Fish Audio use and voice availability remain subject to the provider and voice owner.

[dsh-voice-horn](https://github.com/1DAdidi/dsh-voice-horn) and [dsh-dafeiyu-emotion](https://github.com/LiDu-china/dsh-dafeiyu-emotion) were researched for DSH voice integration. Their code and visual assets are not included. The station background music is original deterministic synthesis in lib/bed.js, without third-party samples.
