# WebRTC playback (initial integration)

Open a viewer URL using **File > Open File/URL**, drag it into the player, or pass
it on the command line. WebRTC URLs bypass yt-dlp and playlist content sniffing.

| Input | Playback |
| --- | --- |
| `https://vdo.ninja/?view=STREAM_ID&password=PASSWORD` | VDO.Ninja viewer |
| `https://vdo.ninja/?room=ROOM&scene&password=PASSWORD` | VDO.Ninja room scene |
| `https://vdo.ninja/?view=STREAM_ID&codec=h264&stereo` | Viewer with explicit codec/audio preferences |
| `https://example.com/live/STREAM_ID/whep` | Direct WHEP endpoint |
| `https://region.meshcast.io/whep/STREAM_ID` | Legacy Meshcast WHEP endpoint |
| `whep://example.com/arbitrary/path` | WHEP over HTTPS |
| `whep+https://example.com/arbitrary/path` | WHEP over HTTPS |
| `whep+http://127.0.0.1:8889/STREAM_ID/whep` | WHEP over HTTP, useful on a local network |
| `vdoninja+https://your-host.example/?view=STREAM_ID` | Self-hosted VDO.Ninja |

`obs.ninja` links and VDO.Ninja subdomains are also recognized. Ordinary HTTP(S)
URLs are only treated as direct WHEP when their path ends in `/whep` (with an
optional trailing slash), or for Meshcast's `/whep/STREAM_ID` endpoints. Use the explicit `whep+https` or `whep+http` scheme
for other endpoint paths. Meshcast viewer pages are not WHEP endpoints: use the
stream's WHEP URL, or its VDO.Ninja viewing link.

For a direct WHEP endpoint requiring bearer authentication, append
`#token=URL_ENCODED_TOKEN`. The receiver extracts this fragment, sends the token
as an Authorization header, and leaves the endpoint's query parameters intact.
Like other URLs opened in MPC-HC, these links may appear in history or saved
playlists; use the existing history exclusion settings for private links.

This implementation embeds **Microsoft Edge WebView2** in MPC-HC's video area.
Install the [WebView2 Evergreen Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)
if it is missing. This playback engine requires Windows 10/11 with a current
runtime; ordinary DirectShow playback retains its existing system requirements.
No camera or microphone permission is granted by this receive-only engine.

VDO.Ninja links load the viewer from the URL's host. This intentionally keeps
passwords, room handling, signaling, data channels, and asynchronous
`whepSettings` / Meshcast handoffs with VDO.Ninja's implementation. The hosted
viewer requires access to its website and signaling services. For a private
deployment, use a self-hosted viewer link. Existing URL parameters are preserved;
`&cleanoutput&autostart` is useful for an uncluttered viewer.

Direct WHEP uses a bundled receiver and does not load the VDO.Ninja website. It
prefers H.264 and Opus while retaining the runtime's other codecs, including VP8,
VP9 and AV1 when available. Opus stereo reception is advertised; mono sources
remain supported. The browser handles RTP, jitter, codec negotiation, and decoding.

Play/Pause and volume/mute control the embedded media. Pause silences and pauses
presentation while the live connection remains active; Play returns to live
media. Stop closes the connection; Play after Stop reconnects. Live streams have
no seekable timeline. Video sizing and fullscreen use the existing player window.
DirectShow filters, LAV decoding, MPC audio processing/output-device settings,
external subtitles, shaders, frame stepping, and Save Image do not apply to this
engine. Browser audio uses the Windows default output device.

The initial direct WHEP implementation supports complete-ICE offers, SDP answers,
the WHEP 406 counter-offer exchange, bearer tokens, and best-effort session DELETE.
Endpoints must support browser CORS, allow POST/DELETE (PATCH for counter-offers),
and expose `Location` through `Access-Control-Expose-Headers`. The bundled page
has an opaque origin (`Origin: null`). Session resources must stay
on the endpoint's origin. There is no trickle ICE, ICE restart, automatic retry,
or server-provided TURN configuration in this first receiver. Reopen a failed
stream to reconnect. A public STUN server is used; restrictive networks requiring
TURN should use a VDO.Ninja viewer configured for that network.

## Build

Run this once from the repository root before building the player:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File build\restore_webview2.ps1
```

The script restores the pinned Microsoft WebView2 SDK 1.0.2903.40 from NuGet into
the ignored `packages` directory. The loader is linked statically, so no separate
WebView2Loader.dll is needed. The runtime itself is installed separately. An
existing SDK can be selected with the MSBuild `WebView2SdkDir` property. Both x86
and x64 player configurations include the integration.

## Validation

`tests/webrtc/build.cmd` compiles URL routing checks and a small Win32 host using
the same `WebRTCPlayer.cpp` and embedded resources as MPC-HC. It can validate the
engine independently when MFC or the full player's dependencies are unavailable.
It uses the current Visual Studio developer environment, or discovers Visual
Studio with `vswhere` and selects its x64 tools.

`tests/webrtc/playback.cjs` uses Playwright and Edge to publish synthetic video
and Opus audio to a local WHEP endpoint, then verifies decoded frames and received
audio in the native WebView2 host. It exercises H.264, VP8, VP9, AV1, volume,
pause/resume, stop/reopen, delayed POST cancellation, HTTP error reporting and
the 406 counter-offer exchange.
Set `VDO_SOURCE` to a local VDO.Ninja source checkout to also publish a synthetic
stream using that application, receive it in the embedded viewer, and advertise
a WHEP endpoint over its data channel (this uses VDO.Ninja's signaling service).
Install Playwright separately or set `PLAYWRIGHT_MODULE` to an existing
installation. The standalone host runs offscreen without taking focus;
artifacts go under `bin/webrtc-tests`.

To run the same streams through the full player, set `MPC_EXE` to a freshly built
MPC-HC executable before running the script. The test makes a portable copy in
`bin/webrtc-tests/app` with isolated settings and drives the player's own commands.
It also checks mute, resizing, fullscreen, the Space shortcut, normal PCM WAV
playback between WebRTC sessions, HTTP URL routing, Close Media, and normal exit.
The application windows are displayed during this test. For example:

```powershell
$env:MPC_EXE = 'bin\mpc-hc_x64\mpc-hc64.exe'
$env:VDO_SOURCE = 'C:\Users\Steve\code\obsninja' # optional local checkout
node tests\webrtc\playback.cjs
```

For release validation, `node tests/webrtc/create-mp4.cjs` generates a synthetic
H.264/AAC MP4 using Edge's encoder. Set `MPC_TEST_MEDIA` to its output
(`bin/webrtc-tests/normal-h264.mp4`) to exercise normal video playback between
WebRTC sessions and assert that the packaged LAV filters are loaded. The test
copies the selected executable's DLLs, LAV filters, renderer and translations
into its isolated portable test directory.

The x64 Release player passed these application checks with H.264, VP8, VP9 and
AV1 video, synthetic mono/stereo Opus sources, a local WHEP endpoint, and the
VDO.Ninja source viewer using its signaling service. The asynchronous handoff
test sends `whepSettings` over VDO.Ninja's data channel and receives the advertised
local WHEP stream. This does not validate a live Meshcast deployment, restrictive
networks, long-running playback, or the x86 application. Exercise those separately
before distributing this integration.

## Portable release packaging

Build the x64 Release player, LAV Filters, icon library and translations using
the [compilation instructions](Compilation.md). Commit the source and create the
annotated release tag, then build the player again so its version records that
commit. Run `powershell -NoProfile -ExecutionPolicy Bypass -File
build/package-vdoninja.ps1 -Version 2.8.3-vdoninja.1` to package that tag.

The packager checks required components and source identity, includes the
Visual C++ runtime and license notices, and writes a portable ZIP and SHA256
checksum under `bin/releases`. It downloads the pinned, SHA256-verified upstream
2.8.2 archive for its ancillary MediaInfo and MPC Video Renderer binaries.
`BUILD-INFO.json` and `FILES.sha256` record the source and individual package
files. Extract and validate the ZIP with `MPC_EXE` pointing at its player before
uploading it. The WebView2 Runtime is a separate runtime prerequisite.
