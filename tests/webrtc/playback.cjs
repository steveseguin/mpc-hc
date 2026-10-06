/* SPDX-License-Identifier: GPL-3.0-or-later */
// Real SDP/ICE/DTLS/SRTP playback through WebRTCPlayer.cpp and WebView2.
// npm install --no-save playwright, then node tests/webrtc/playback.cjs
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const {spawn, execFileSync} = require('node:child_process');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const appMode = !!process.env.MPC_EXE;
const testVolume = appMode ? Math.pow(10, Math.trunc(4000 * Math.log10(0.32)) / 2000) : 0.1;
function appControl(pid, action, value = '') {
    return execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', path.resolve('tests/webrtc/app-control.ps1'), '-ProcessId', String(pid),
        '-Action', action, '-Value', String(value)], {windowsHide:true, encoding:'utf8'}).trim();
}

(async () => {
    let publisher, host, viewer, browser;
    let hwnd;
    let codec = 'H264';
    let deleted = 0;
    let offers = 0;
    let patches = 0;
    let delayAnswer = 0;
    let attempt = 0;
    let debugPort;
    let openingRect;
    const server = http.createServer(async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS, PATCH');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.setHeader('Access-Control-Expose-Headers', 'Location');
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
        if (process.env.VDO_SOURCE && req.method === 'GET' && req.url.startsWith('/vdo/')) {
            const root = path.resolve(process.env.VDO_SOURCE);
            let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname.slice(5));
            if (!pathname || pathname.endsWith('/')) pathname += 'index.html';
            const filename = path.resolve(root, pathname);
            if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
                res.writeHead(404); res.end(); return;
            }
            const mime = {'.html':'text/html','.js':'application/javascript','.json':'application/json',
                '.css':'text/css','.svg':'image/svg+xml','.wasm':'application/wasm','.png':'image/png'};
            res.setHeader('Content-Type', mime[path.extname(filename)] || 'application/octet-stream');
            fs.createReadStream(filename).pipe(res); return;
        }
        if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
        if (req.method === 'DELETE') {
            assert.equal(req.headers.authorization, 'Bearer local-test');
            deleted++; res.writeHead(200); res.end(); return;
        }
        if (req.method === 'PATCH') {
            let answer = '';
            for await (const chunk of req) answer += chunk;
            await publisher.evaluate(sdp => sender.setRemoteDescription({type:'answer', sdp}), answer);
            patches++;
            res.writeHead(204); res.end(); return;
        }
        if (req.method !== 'POST') {
            res.setHeader('Content-Type', 'text/html');
            res.end('<!doctype html><title>Local WebRTC publisher</title>'); return;
        }
        if (req.url.startsWith('/denied/')) { res.writeHead(401); res.end(); return; }
        let offer = '';
        for await (const chunk of req) offer += chunk;
        try {
            offers++;
            assert.equal(req.headers.authorization, 'Bearer local-test');
            assert.match(offer, /a=recvonly/);
            assert.match(offer, /opus\/48000\/2/);
            const counterOffer = req.url.startsWith('/counter/');
            const answer = await publisher.evaluate(async ({offer, codec, counterOffer}) => {
                if (window.sender) window.sender.close();
                const pc = window.sender = new RTCPeerConnection();
                // Model a server with exactly one installed video decoder/
                // encoder. Restrict its view of the offer before negotiation;
                // preferences alone do not necessarily switch a live encoder.
                const sections = offer.split('\r\nm=');
                offer = sections.map(section => {
                    if (!section.startsWith('video ')) return section;
                    const lines = section.split('\r\n');
                    const allowed = new Set(lines.filter(line =>
                        new RegExp(`^a=rtpmap:\\d+ ${codec}/`, 'i').test(line)).map(line => line.match(/^a=rtpmap:(\d+)/)[1]));
                    lines[0] = lines[0].split(' ').slice(0, 3).concat([...allowed]).join(' ');
                    return lines.filter(line => {
                        const match = /^a=(?:rtpmap|fmtp|rtcp-fb):(\d+)/.exec(line);
                        return !match || allowed.has(match[1]);
                    }).join('\r\n');
                }).join('\r\nm=');
                if (counterOffer) {
                    pc.addTransceiver('audio', {direction:'sendonly'});
                    pc.addTransceiver('video', {direction:'sendonly'});
                } else {
                    await pc.setRemoteDescription({type:'offer', sdp: offer});
                }
                const canvas = window.videoCanvas = document.createElement('canvas');
                canvas.width = 640; canvas.height = 360;
                const ctx = canvas.getContext('2d');
                let frame = 0;
                clearInterval(window.drawTimer);
                window.drawTimer = setInterval(() => {
                    ctx.fillStyle = frame++ % 2 ? '#128841' : '#2040bb';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.fillStyle = '#fff'; ctx.font = '30px sans-serif';
                    ctx.fillText(`MPC WebRTC ${codec} ${frame}`, 40, 100);
                }, 50);
                const track = canvas.captureStream(20).getVideoTracks()[0];
                const transceiver = pc.getTransceivers().find(t => t.receiver.track.kind === 'video');
                await transceiver.sender.replaceTrack(track);
                transceiver.direction = 'sendonly';
                if (window.audio) await window.audio.close();
                const audio = window.audio = new AudioContext();
                const oscillator = audio.createOscillator();
                const gain = audio.createGain(); gain.gain.value = 0.03;
                const output = audio.createMediaStreamDestination();
                output.channelCount = codec === 'VP8' ? 1 : 2;
                oscillator.connect(gain).connect(output); oscillator.start();
                await audio.resume();
                const sound = pc.getTransceivers().find(t => t.receiver.track.kind === 'audio');
                await sound.sender.replaceTrack(output.stream.getAudioTracks()[0]);
                sound.direction = 'sendonly';
                await pc.setLocalDescription(counterOffer ? await pc.createOffer() : await pc.createAnswer());
                if (pc.iceGatheringState !== 'complete') await new Promise(resolve => {
                    pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') resolve(); };
                });
                return pc.localDescription.sdp;
            }, {offer, codec, counterOffer});
            if (delayAnswer) await sleep(delayAnswer);
            res.writeHead(counterOffer ? 406 : 201, {'Content-Type':'application/sdp', Location:'/session/1'});
            res.end(answer);
        } catch (error) { console.error(error); res.writeHead(500); res.end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    async function native(message, value = 0) {
        if (appMode) {
            if (message === 4) appControl(host.pid, 'volume', value === -10000 ? 0 : 32);
            else appControl(host.pid, 'command', {1:887, 2:888, 3:890}[message]);
            return;
        }
        // Send commands through the same public native methods used by MPC's graph.
        execFileSync('powershell.exe', ['-NoProfile', '-Command',
            `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W { [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr w, IntPtr l); }'; [W]::PostMessage([IntPtr]${hwnd}, ${32768 + message}, [IntPtr]::Zero, [IntPtr]${value}) | Out-Null`], {windowsHide:true});
    }
    async function start(url) {
        hwnd = null;
        debugPort = port + 1 + attempt++;
        let executable = path.resolve('bin/webrtc-tests/host.exe');
        if (appMode) {
            // Portable test copy: never modify the user's player settings.
            const folder = path.resolve('bin/webrtc-tests/app');
            fs.mkdirSync(folder, {recursive:true});
            executable = path.join(folder, 'mpc-hc64.exe');
            const source = path.resolve(process.env.MPC_EXE);
            fs.copyFileSync(source, executable);
            // Include the release's dependencies so normal media exercises the
            // packaged filters, renderer and runtime as well as the player.
            for (const entry of fs.readdirSync(path.dirname(source), {withFileTypes:true})) {
                if (entry.isFile() && entry.name.toLowerCase().endsWith('.dll') ||
                    entry.isDirectory() && ['LAVFilters64','MPCVR','Lang','Shaders','Shaders11'].includes(entry.name)) {
                    fs.cpSync(path.join(path.dirname(source), entry.name), path.join(folder, entry.name), {recursive:true});
                }
            }
            fs.writeFileSync(path.join(folder, 'mpc-hc64.ini'), '[Settings]\r\nVolume=50\r\nMute=0\r\nKeepHistory=0\r\nUpdaterAutoCheck=0\r\nLimitWindowProportions=1\r\n');
        }
        host = spawn(executable, appMode ? ['/new'] : [url], {
            windowsHide:true, env:{...process.env,
                WEBVIEW2_USER_DATA_FOLDER:path.resolve(`bin/webrtc-tests/profile-${attempt}`),
                WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${debugPort}`}
        });
        host.stdout.on('data', data => {
            const match = /hwnd:(\d+)/.exec(data.toString());
            if (match) hwnd = match[1];
            process.stdout.write(data);
        });
        host.stderr.on('data', () => {});
        if (appMode) {
            for (let i = 0; i < 50 && !hwnd; i++) {
                try { hwnd = appControl(host.pid, 'find'); }
                catch { await sleep(200); }
            }
            assert.ok(hwnd, 'MPC main window exists');
            appControl(host.pid, 'show');
            appControl(host.pid, 'resize');
            openingRect = JSON.parse(appControl(host.pid, 'rect'));
            appControl(host.pid, 'open', url);
        }
        return connectViewer();
    }
    async function connectViewer() {
        viewer = null;
        for (let i = 0; i < 150; i++) {
            if (host.exitCode !== null) throw new Error(`Host exited ${host.exitCode}`);
            try { viewer = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, {timeout:2000}); break; }
            catch { await sleep(200); }
        }
        assert.ok(viewer, 'WebView2 debugging endpoint available');
        let page;
        for (let i = 0; i < 100; i++) {
            page = viewer.contexts()[0]?.pages()[0];
            if (page) break;
            await sleep(100);
        }
        assert.ok(page, 'WebView2 document exists');
        page.setDefaultTimeout(15000);
        console.log('WebView2 page connected:', page.url());
        return page;
    }
    async function closeHost() {
        if (viewer) { await viewer.close(); viewer = null; }
        if (host) {
            if (appMode && host.exitCode === null) appControl(host.pid, 'close');
            else if (!appMode)
            execFileSync('powershell.exe', ['-NoProfile', '-Command',
                `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W { [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr w, IntPtr l); }'; [W]::PostMessage([IntPtr]${hwnd || 0}, 16, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null`], {windowsHide:true});
            for (let i = 0; i < 30 && host.exitCode === null; i++) await sleep(100);
            const cleanExit = host.exitCode === 0;
            if (host.exitCode === null) host.kill();
            host = null;
            if (appMode) assert.ok(cleanExit, 'MPC exits normally after closing playback');
        }
    }
    try {
        browser = await chromium.launch({channel:'msedge', headless:true, args:['--autoplay-policy=no-user-gesture-required',
            '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']});
        publisher = await browser.newPage();
        await publisher.goto(`http://127.0.0.1:${port}/publisher`);
        for (codec of (process.env.WEBRTC_TEST_CODECS || 'H264,VP8,VP9,AV1').split(',')) {
            const page = await start(`whep+http://127.0.0.1:${port}/test/whep#token=local-test`);
            page.on('pageerror', error => console.error('Viewer script:', error));
            await page.waitForFunction(() => {
                const video = document.querySelector('video');
                return video && video.videoWidth === 640 && video.getVideoPlaybackQuality().totalVideoFrames > 5 && !video.paused;
            }, null, {timeout:60000, polling:200});
            const stats = await page.evaluate(async () => {
                const report = await current.pc.getStats();
                return [...report.values()].filter(s => s.type === 'inbound-rtp').map(s => ({
                    kind:s.kind, bytes:s.bytesReceived, codec:report.get(s.codecId)?.mimeType,
                    frames:s.framesDecoded, samples:s.totalSamplesReceived, energy:s.totalAudioEnergy
                }));
            });
            console.log(appMode ? 'Decoded in MPC-HC:' : 'Decoded in native WebView2 host:', codec, stats);
            if (appMode) assert.deepEqual(JSON.parse(appControl(host.pid, 'rect')), openingRect, 'Opening WebRTC preserves the chosen window');
            assert.ok(stats.some(s => s.codec?.toLowerCase() === `video/${codec.toLowerCase()}` && s.frames > 0));
            assert.ok(stats.some(s => s.codec === 'audio/opus' && s.samples > 0 && s.energy > 0));
            await native(4, -2000);
            await page.waitForFunction(level => Math.abs(document.querySelector('video').volume - level) < 0.001, testVolume, {polling:200});
            await native(2);
            await page.waitForFunction(() => document.querySelector('video').paused && document.querySelector('video').volume === 0, null, {polling:200});
            await native(1);
            await page.waitForFunction(level => !document.querySelector('video').paused && Math.abs(document.querySelector('video').volume - level) < 0.001, testVolume, {polling:200});
            if (appMode && codec === 'H264') {
                appControl(host.pid, 'command', 909);
                await page.waitForFunction(() => document.querySelector('video').volume === 0);
                appControl(host.pid, 'command', 909);
                await page.waitForFunction(() => document.querySelector('video').volume > 0);
                appControl(host.pid, 'resize');
                await sleep(500);
                const windowed = await page.evaluate(() => ({width:innerWidth, height:innerHeight}));
                assert.ok(windowed.width > 500 && windowed.height > 200, 'MPC video area has visible bounds');
                // A browser viewport must not depend on the encoded resolution,
                // even with native "normal size" video framing and automatic
                // window proportions enabled. Change actual RTP video frames.
                appControl(host.pid, 'command', 836);
                for (const [width, height] of [[160,90], [1280,720], [360,640], [640,360]]) {
                    await publisher.evaluate(([w,h]) => { videoCanvas.width = w; videoCanvas.height = h; }, [width,height]);
                    await page.waitForFunction(([w,h]) => {
                        const video = document.querySelector('video');
                        return video.videoWidth === w && video.videoHeight === h;
                    }, [width,height], {timeout:30000});
                    await sleep(900); // Include the bridge's next size notification.
                    assert.deepEqual(JSON.parse(appControl(host.pid, 'rect')), openingRect, `Window stays fixed for ${width}x${height}`);
                    assert.deepEqual(await page.evaluate(() => ({width:innerWidth, height:innerHeight})), windowed, 'Browser fills the same viewing area');
                }
                appControl(host.pid, 'command', 839);
                console.log('PASS: adaptive 160x90, 1280x720, portrait 360x640 and 640x360 preserve window and viewport');
                appControl(host.pid, 'command', 830);
                await page.waitForFunction(size => innerWidth > size.width && innerHeight > size.height, windowed);
                appControl(host.pid, 'command', 830);
                await page.waitForFunction(size => innerWidth === size.width && innerHeight === size.height, windowed);
                appControl(host.pid, 'key', 32);
                await page.waitForFunction(() => document.querySelector('video').paused);
                appControl(host.pid, 'key', 32);
                await page.waitForFunction(() => !document.querySelector('video').paused);
                appControl(host.pid, 'screenshot', path.resolve('bin/webrtc-tests/mpc-h264.png'));
                console.log('PASS: MPC mute, resize, fullscreen round trip and Space shortcut');
            }
            if (codec === 'H264') await page.screenshot({path:'bin/webrtc-tests/whep-h264.png'});
            const before = deleted;
            await native(3);
            await page.waitForFunction(() => document.querySelector('video').srcObject === null, null, {polling:200});
            for (let i = 0; i < 30 && deleted === before; i++) await sleep(100);
            assert.ok(deleted > before, 'Stop deletes WHEP session');
            await native(1);
            await page.waitForFunction(() => current?.pc.connectionState === 'connected' && document.querySelector('video')?.videoWidth === 640, null, {timeout:60000, polling:200});
            if (appMode && codec === 'H264') {
                // Exercise graph destruction and reconstruction in one player,
                // including a regular DirectShow audio file between streams.
                const wave = Buffer.alloc(44 + 48000 * 2 * 30);
                wave.write('RIFF'); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVEfmt ', 8);
                wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
                wave.writeUInt32LE(48000, 24); wave.writeUInt32LE(96000, 28);
                wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34); wave.write('data', 36);
                wave.writeUInt32LE(wave.length - 44, 40);
                for (let i = 44; i < wave.length; i += 2) wave.writeInt16LE(Math.round(500 * Math.sin((i-44)/2 * 2*Math.PI*220/48000)), i);
                const wavePath = path.resolve('bin/webrtc-tests/tone.wav');
                fs.writeFileSync(wavePath, wave);
                appControl(host.pid, 'open', process.env.MPC_TEST_MEDIA ? path.resolve(process.env.MPC_TEST_MEDIA) : wavePath);
                let status = '';
                for (let i = 0; i < 40; i++) {
                    await sleep(200);
                    status = appControl(host.pid, 'text');
                    if (page.isClosed() && status.includes('Playing')) break;
                }
                assert.ok(page.isClosed(), 'Opening a regular file destroys the WebRTC graph');
                assert.match(status, /Playing/, 'Regular media plays after WebRTC');
                if (process.env.MPC_TEST_MEDIA) {
                    assert.match(status, /640x360/, 'Normal H.264 video dimensions are reported');
                    assert.notDeepEqual(JSON.parse(appControl(host.pid, 'rect')), openingRect, 'Normal file auto-zoom still works after WebRTC');
                    const modules = JSON.parse(appControl(host.pid, 'modules'));
                    for (const name of ['LAVVideo.ax', 'LAVAudio.ax', 'LAVSplitter.ax']) {
                        assert.ok(modules.some(module => module.toLowerCase() === path.resolve('bin/webrtc-tests/app/LAVFilters64', name).toLowerCase()), `Packaged ${name} is loaded`);
                    }
                    appControl(host.pid, 'screenshot', path.resolve('bin/webrtc-tests/mpc-normal-h264.png'));
                }
                appControl(host.pid, 'command', 888);
                await sleep(300);
                assert.match(appControl(host.pid, 'text'), /Paused/, 'Regular playback can pause');
                appControl(host.pid, 'open', `http://127.0.0.1:${port}/test/whep#token=local-test`);
                if (viewer) await viewer.close();
                const reopened = await connectViewer();
                await reopened.waitForFunction(() => document.querySelector('video')?.getVideoPlaybackQuality().totalVideoFrames > 5, null, {timeout:60000});
                appControl(host.pid, 'command', 803);
                for (let i = 0; i < 30 && !reopened.isClosed(); i++) await sleep(100);
                assert.ok(reopened.isClosed(), 'Close Media destroys the receiver');
                console.log(`PASS: WebRTC → regular ${process.env.MPC_TEST_MEDIA ? 'H.264/AAC (packaged LAV)' : 'WAV'} → HTTP WHEP switching and Close Media`);
            }
            await closeHost();
        }
        codec = 'H264';
        delayAnswer = 2500;
        const oldOffers = offers;
        const oldDeletes = deleted;
        let page = await start(`whep+http://127.0.0.1:${port}/test/whep#token=local-test`);
        for (let i = 0; i < 100 && offers === oldOffers; i++) await sleep(100);
        assert.ok(offers > oldOffers, 'POST is in flight');
        await native(3);
        await page.waitForFunction(() => current === null, null, {polling:100});
        for (let i = 0; i < 100 && deleted === oldDeletes; i++) await sleep(100);
        assert.ok(deleted > oldDeletes, 'Stopping during POST deletes the late session');
        assert.equal(await page.evaluate(() => current), null);
        await closeHost();
        delayAnswer = 0;
        page = await start(`whep+http://127.0.0.1:${port}/denied/whep`);
        if (appMode) {
            // MPC consumes EC_BG_ERROR and closes the graph; the error belongs
            // in its status bar, and the WebView document is destroyed.
            let status = '';
            for (let i = 0; i < 30 && !status.includes('HTTP 401'); i++) {
                await sleep(200);
                status = appControl(host.pid, 'text');
            }
            assert.match(status, /HTTP 401/, 'MPC displays the WHEP error');
        } else {
            await page.waitForFunction(() => document.querySelector('#status')?.textContent.includes('HTTP 401'), null, {polling:100});
        }
        await closeHost();
        console.log('PASS: pending-POST cancellation and HTTP error reporting');
        page = await start(`whep+http://127.0.0.1:${port}/counter/whep#token=local-test`);
        await page.waitForFunction(() => current?.pc.connectionState === 'connected' && document.querySelector('video')?.getVideoPlaybackQuality().totalVideoFrames > 5, null, {timeout:45000,polling:200});
        assert.ok(patches > 0, 'WHEP counter-offer answered with PATCH');
        await closeHost();
        console.log('PASS: WHEP 406 counter-offer and PATCH answer');

        if (process.env.VDO_SOURCE) {
            const id = `mpchc_${Date.now().toString(36)}`;
            const source = await browser.newPage();
            await source.goto(`http://127.0.0.1:${port}/vdo/?push=${id}&password=false&autostart&webcam&codec=h264`, {waitUntil:'domcontentloaded'});
            await source.waitForFunction(() => [...document.querySelectorAll('video')].some(v => v.videoWidth > 0), null, {timeout:60000});
            page = await start(`vdoninja+http://127.0.0.1:${port}/vdo/?view=${id}&password=false&cleanoutput&autostart&codec=h264`);
            await page.waitForFunction(() => [...document.querySelectorAll('video')].some(v => v.videoWidth > 0 && v.getVideoPlaybackQuality().totalVideoFrames > 5), null, {timeout:60000,polling:200});
            await native(4, -2000);
            await page.waitForFunction(level => Math.abs(session.volume - level) < 0.001, testVolume, {polling:200});
            await native(2);
            await page.waitForFunction(() => session.volume === 0 && [...document.querySelectorAll('video')].every(v => v.paused), null, {polling:200});
            await native(1);
            await page.waitForFunction(() => session.volume > 0 && [...document.querySelectorAll('video')].some(v => !v.paused && v.videoWidth > 0), null, {polling:200});
            await page.screenshot({path:'bin/webrtc-tests/vdoninja-h264.png'});
            console.log('PASS: VDO.Ninja publisher to native viewer, volume and pause/resume');
            const handoffOffers = offers;
            const sent = await source.evaluate(url => {
                const peer = Object.keys(session.pcs).find(id => session.pcs[id].sendChannel?.readyState === 'open');
                return peer && session.sendMessage({whepSettings:{type:'whep', url, token:'local-test', started:Date.now()}}, peer);
            }, `http://127.0.0.1:${port}/test/whep`);
            assert.equal(sent, true, 'whepSettings sent through the VDO.Ninja data channel');
            for (let i = 0; i < 100 && offers === handoffOffers; i++) await sleep(100);
            await page.waitForFunction(async () => {
                for (const peer of Object.values(session.rpcs)) {
                    if (!peer.whep?.getStats) continue;
                    const stats = await peer.whep.getStats();
                    if ([...stats.values()].some(s => s.type === 'inbound-rtp' && s.kind === 'video' && s.framesDecoded > 5)) return true;
                }
                return false;
            }, null, {timeout:60000,polling:200});
            assert.ok(offers > handoffOffers, 'Viewer requested the advertised WHEP endpoint');
            await native(4, -10000);
            await page.waitForFunction(() => session.volume === 0 && [...document.querySelectorAll('video,audio')].every(v => v.volume === 0 || v.muted), null, {polling:200});
            console.log('PASS: asynchronous data-channel whepSettings playback and mute');
            await closeHost();
            await source.close();
        }
        console.log(`PASS: native playback, Opus, pause/resume, volume, stop/reopen; ${offers} offers, ${deleted} DELETEs`);
    } finally {
        await closeHost();
        if (browser) await browser.close();
        server.closeAllConnections(); server.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
