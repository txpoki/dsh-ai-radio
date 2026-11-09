# Source acknowledgments

The following files are adapted from [kendu76/dsh-music-player](https://github.com/kendu76/dsh-music-player), MIT, copyright (c) 2026 kendu76:

- `lib/vendor/netease.js`: NetEase login, encrypted API calls and playlist reading. Import path adjusted; the radio's authorized stream resolution and listening-history extension live separately in `lib/music.js`.
- `lib/vendor/news-core.js` and `calendar.js`: RSS parsing, default feed catalog and title deduplication helpers.
- `lib/vendor/qrcode.mjs`: upstream embedded qrcode-generator (Kazuhiko Arase, MIT; license retained in file).

The full upstream MIT notice is retained at `lib/vendor/LICENSE.dsh-music-player`.

Design and code studies: [Claudio](https://github.com/hllqkb/Claudio), MIT, for typed music/speech playback plans and context assembly; [Aurio](https://github.com/baogutang/aurio), MIT, for contextual DJ persona and automatic queue refilling; [XRadio](https://github.com/ibrahimirdem/xradio), MIT, for talk/music ducking. No code from these three projects is copied into this repository.

Music is streamed using the listener's own NetEase account permissions. This plugin does not unlock unavailable tracks or redistribute a music library. The MIT license covers this software, not third-party music, API services, or voice rights.
