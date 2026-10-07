# WebRTC playback (initial integration)

## WebView2 setup and troubleshooting

VDO.Ninja and WHEP streams use **WebView2**, an embedded browser engine inside
MPC-HC's video area. The portable player ZIP does **not** include that runtime.
Normal file playback uses MPC-HC's existing engine and does not need WebView2.

### Install the runtime

1. Open [Microsoft's WebView2 download page](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).
2. Choose **Evergreen Bootstrapper** for an online installation. It downloads
   the runtime appropriate for your computer. For offline installation on an
   Intel/AMD 64-bit PC, choose **Evergreen Standalone Installer > x64**.
3. Run the installer and let it finish. Close MPC-HC completely, then reopen
   `mpc-hc64.exe` from your extracted VDO.Ninja Edition folder.
4. Use **File > Open File/URL** (`Ctrl+O`) to open your viewing link.

These are runtime installers; you do not need the developer SDK. The
[WebView2 Runtime works independently of the Edge browser](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/end-user-faq#will-uninstalling-microsoft-edge-make-webview2-stop-working),
so installing Edge itself is not a prerequisite.

**Do I need administrator rights?** Microsoft supports per-user installation
when the installer runs without elevation, and machine-wide installation when
elevated. An existing machine-wide Edge Updater can change that behavior; managed
PC policies may also apply. See [Microsoft's installation details](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution#installing-the-runtime-as-per-machine-or-per-user).

**Will an old Windows 10 installation work?** Press **Win+R**, type `winver`, and
check your edition and version. Microsoft lists Windows 10 version **1709 and
later**, plus specific older Enterprise LTSC editions; see the
[supported Windows versions](https://learn.microsoft.com/en-us/microsoft-edge/webview2/#supported-windows-versions).
Having no Edge browser does not by itself mean Windows is incompatible. This
fork's WebRTC playback requires Windows 10/11 and a current runtime; it does not
support WebRTC on Windows 7/8/8.1.

**Can I just copy a DLL into the MPC-HC folder?** No. `WebView2Loader.dll` only
helps an application locate the browser runtime. This player already links the
loader into its executable, so adding that DLL will not fix a missing runtime.
Use the installer above or the complete Fixed Version option below.

### Keep your existing MPC-HC installation

Extract the [VDO.Ninja Edition ZIP](https://github.com/steveseguin/mpc-hc/releases/latest)
into a separate writable folder. Keep all its files, including `mpc-hc64.ini`,
and launch its `mpc-hc64.exe` directly. The included INI enables portable player
settings; do not overwrite the files in your regular MPC-HC installation.
Close other MPC-HC instances first if a link opens in the wrong player.

The player settings stay beside the executable. WebView2's browser profile and
cache are stored separately in `%LOCALAPPDATA%\MPC-HC\WebRTC`, so this is not a
fully self-contained browser profile. Installing the runtime does not replace
your MPC-HC application. Evergreen is shared with other WebView2 apps and
[updates independently](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/evergreen-vs-fixed-version#the-evergreen-runtime-distribution-mode)
of this fork's default-off player update checks.

### Use a local runtime folder without installing Evergreen

Microsoft also offers a **Fixed Version** runtime on the
[same download page](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).
It is a complete browser folder, not a DLL, and adds hundreds of megabytes.
This advanced setup has not been validated for this release; Evergreen is the
recommended setup for users.

1. Download the **x64 Fixed Version** runtime for this x64 player. Extract the
   entire package using Microsoft's [Fixed Version deployment instructions](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution#the-fixed-version-runtime-distribution-mode).
   Keep it on a local disk, not a network share.
2. Arrange the extracted files so `WebView2\msedgewebview2.exe` exists beside
   `mpc-hc64.exe`, keeping all runtime subfolders and files intact.
3. On **Windows 10**, follow the folder-permission commands in those Microsoft
   instructions. Fixed Version 120 and later need the documented read/execute
   permissions for the application-container groups.
4. Save the following as `Start-MPC-WebView2.cmd` beside `mpc-hc64.exe`. Close
   existing MPC-HC instances, then launch this file:

```bat
@echo off
setlocal
set "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER=%~dp0WebView2"
"%~dp0mpc-hc64.exe" %*
endlocal
```

This uses Microsoft's supported [runtime-folder environment override](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/webview2-idl?view=webview2-1.0.3537.50#createcorewebview2environmentwithoptions)
for the launched process. The current player does not automatically search for a
runtime beside its executable. Fixed Version runtimes require
[manual updates](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/evergreen-vs-fixed-version#the-fixed-version-runtime-distribution-mode);
the browser profile still uses the location described above.

### If playback still will not start

If MPC-HC reports that WebView2 is required, finish the runtime installation and
restart the player first. If the installer fails, check `winver` against the
supported versions above and try the matching Evergreen Standalone Installer.
Microsoft links its [installation troubleshooting](https://support.microsoft.com/en-us/edge/troubleshooting-tips-for-downloading-installing-and-updating-microsoft-edge)
from the runtime download page.

If the error remains, include your Windows edition/version, MPC-HC release,
runtime version (if installed), and exact error text when reporting it. The
player's runtime-required message can also indicate a runtime initialization
failure; it does not prove that a DLL is missing.

## Open a stream

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

For runtime requirements and installation, see
[WebView2 setup and troubleshooting](#webview2-setup-and-troubleshooting).
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
no seekable timeline. Opening, reconnecting, and adaptive resolution changes
preserve the existing window size. The browser fills MPC's video area and owns
letterboxing and scene layout. Manual window resizing and fullscreen work;
DirectShow video-frame sizing and pan/scan settings do not control the browser.
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
The H.264 publisher changes between 160x90, 1280x720, portrait 360x640 and 640x360
while assertions check that both the window and browser viewport remain fixed.
These checks also cover opening with automatic window proportions enabled and
MPC's native "normal size" video framing.
The application windows are displayed during this test. For example:

```powershell
$env:MPC_EXE = 'bin\mpc-hc_x64\mpc-hc64.exe'
$env:VDO_SOURCE = 'C:\Users\Steve\code\obsninja' # optional local checkout
node tests\webrtc\playback.cjs
```

To validate an existing hosted stream, set `MPC_EXE` and `VDO_TEST_URL`, then run
`node tests/webrtc/live-viewer.cjs`. This uses the exact supplied viewing URL in
an isolated portable player. It checks sustained frame delivery, stable window
and viewport sizes, landscape/portrait window resizing, fullscreen and return,
volume, mute, pause/resume, Stop/Play reconnect, clean exit and the default-off
update setting. Allow roughly three minutes with an active publisher. Logs and
screenshots stay under the ignored `bin/webrtc-tests` directory.

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
build/package-vdoninja.ps1 -Version 2.8.4-vdoninja.2` to package that tag.

The packager checks required components and source identity, includes the
Visual C++ runtime and license notices, and writes a portable ZIP and SHA256
checksum under `bin/releases`. It downloads the pinned, SHA256-verified upstream
2.8.2 archive for its ancillary MediaInfo and MPC Video Renderer binaries.
`BUILD-INFO.json` and `FILES.sha256` record the source and individual package
files. Extract and validate the ZIP with `MPC_EXE` pointing at its player before
uploading it. The WebView2 Runtime is a separate runtime prerequisite.

Automatic version checks default to disabled both in the application and in the
portable settings. Manual checks and explicitly enabled automatic checks fetch
`steveseguin/mpc-hc`'s `develop/version.txt`; the CDN backup uses the same fork.
The download button opens `https://github.com/steveseguin/mpc-hc/releases`.
There is no upstream update feed or upstream fallback.
