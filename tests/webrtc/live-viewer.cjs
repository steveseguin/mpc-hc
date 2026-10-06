/* SPDX-License-Identifier: GPL-3.0-or-later */
// Exercise a real hosted viewer without modifying the user's MPC settings.
// MPC_EXE=... VDO_TEST_URL=https://vdo.ninja/?view=... node tests/webrtc/live-viewer.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawn, execFileSync} = require('node:child_process');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const control = (pid, action, value = '') => execFileSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('tests/webrtc/app-control.ps1'),
    '-ProcessId', String(pid), '-Action', action, '-Value', String(value)
], {windowsHide:true, encoding:'utf8'}).trim();

(async () => {
    assert.ok(process.env.MPC_EXE && process.env.VDO_TEST_URL, 'Set MPC_EXE and VDO_TEST_URL');
    const folder = path.resolve(`bin/webrtc-tests/live-${Date.now()}`);
    fs.mkdirSync(folder, {recursive:true});
    const executable = path.join(folder, 'mpc-hc64.exe');
    fs.copyFileSync(path.resolve(process.env.MPC_EXE), executable);
    // Deliberately omit UpdaterAutoCheck to exercise this edition's default.
    const ini = path.join(folder, 'mpc-hc64.ini');
    fs.writeFileSync(ini, '[Settings]\r\nVolume=0\r\nKeepHistory=0\r\n');
    const debugPort = 19541;
    const app = spawn(executable, ['/new'], {windowsHide:true, env:{...process.env,
        WEBVIEW2_USER_DATA_FOLDER:path.join(folder, 'webview'),
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${debugPort}`}});
    let browser;
    try {
        let found = false;
        for (let i = 0; i < 50 && !found; i++) {
            try { control(app.pid, 'show'); found = true; } catch { await sleep(200); }
        }
        assert.ok(found, 'MPC started');
        const rect = () => JSON.parse(control(app.pid, 'rect'));
        control(app.pid, 'resize');
        const initial = rect();
        control(app.pid, 'open', process.env.VDO_TEST_URL);
        for (let i = 0; i < 100 && !browser; i++) {
            try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, {timeout:1000}); }
            catch { await sleep(200); }
        }
        assert.ok(browser, 'WebView2 started without an updater prompt');
        let page;
        for (let i = 0; i < 100 && !page; i++) {
            page = browser.contexts()[0]?.pages()[0];
            if (!page) await sleep(100);
        }
        assert.ok(page, 'Viewer document exists');
        page.setDefaultTimeout(60000);
        await page.waitForURL(url => /^https?:/.test(url.protocol), {waitUntil:'domcontentloaded'});
        const playing = async () => page.waitForFunction(() => [...document.querySelectorAll('video')]
            .some(v => !v.paused && v.videoWidth > 0 && v.getVideoPlaybackQuality().totalVideoFrames > 5));
        const viewport = () => page.evaluate(() => [innerWidth, innerHeight]);
        async function stable(label, expected, seconds) {
            const view = await viewport();
            const end = Date.now() + seconds * 1000;
            let previousFrames = -1;
            let progress = 0;
            let lastSize;
            while (Date.now() < end) {
                assert.deepEqual(rect(), expected, `${label}: window position and size stay fixed`);
                assert.deepEqual(await viewport(), view, `${label}: browser viewport stays fixed`);
                const videos = await page.evaluate(() => [...document.querySelectorAll('video')].filter(v => v.videoWidth > 0)
                    .map(v => ({size:[v.videoWidth,v.videoHeight], display:[v.clientWidth,v.clientHeight],
                        frames:v.getVideoPlaybackQuality().totalVideoFrames, paused:v.paused})));
                assert.ok(videos.some(v => !v.paused && v.display[0] > 200 && v.display[1] > 100), 'Live picture remains visible');
                const frames = videos.reduce((sum,v) => sum + v.frames, 0);
                if (frames > previousFrames) progress++;
                previousFrames = frames;
                const size = JSON.stringify(videos.map(v => v.size));
                if (lastSize !== size) {
                    console.log(label, JSON.stringify({window:expected, viewport:view, videos}));
                    lastSize = size;
                }
                await sleep(1000);
            }
            assert.ok(progress >= 3, 'Video frames continue arriving');
            console.log(`PASS: ${label} stable for ${seconds}s`);
        }
        await playing();
        await stable('Open and adaptive resolution', initial, 40);
        for (const size of ['600x760', '1100x700']) {
            control(app.pid, 'resize', size);
            await sleep(500);
            await stable(`Manual resize ${size}`, rect(), 20);
        }
        const windowed = rect();
        const windowedView = await viewport();
        control(app.pid, 'command', 830);
        await page.waitForFunction(([w,h]) => innerWidth > w && innerHeight > h, windowedView);
        await stable('Fullscreen', rect(), 20);
        control(app.pid, 'command', 830);
        await page.waitForFunction(([w,h]) => innerWidth === w && innerHeight === h, windowedView);
        await stable('Fullscreen return', windowed, 20);
        control(app.pid, 'volume', 32);
        await page.waitForFunction(() => session.volume > 0 && session.volume < 0.2);
        control(app.pid, 'command', 909);
        await page.waitForFunction(() => session.volume === 0);
        control(app.pid, 'command', 909);
        await page.waitForFunction(() => session.volume > 0);
        control(app.pid, 'volume', 0);
        control(app.pid, 'command', 888);
        await page.waitForFunction(() => [...document.querySelectorAll('video')].every(v => v.paused));
        assert.deepEqual(rect(), windowed, 'Pause preserves the window');
        control(app.pid, 'command', 887);
        await playing();
        control(app.pid, 'command', 890);
        await page.waitForURL('about:blank');
        assert.deepEqual(rect(), windowed, 'Stop preserves the window');
        control(app.pid, 'command', 887);
        await playing();
        await stable('Reconnect', windowed, 40);
        control(app.pid, 'screenshot', path.join(folder, 'player.png'));
        console.log('PASS: hosted viewer volume, mute, pause/resume, stop/reconnect; screenshot:', path.join(folder, 'player.png'));
    } finally {
        if (browser) await browser.close();
        if (app.exitCode === null) {
            control(app.pid, 'close');
            for (let i = 0; i < 50 && app.exitCode === null; i++) await sleep(100);
            if (app.exitCode === null) app.kill();
        }
    }
    assert.equal(app.exitCode, 0, 'MPC exits normally');
    const settingsBytes = fs.readFileSync(ini);
    const settings = settingsBytes.toString(settingsBytes[0] === 0xff ? 'utf16le' : 'utf8');
    assert.match(settings, /^UpdaterAutoCheck=0\r?$/m, 'Automatic update checks default to off');
    console.log('PASS: automatic update checks default to off');
})().catch(error => { console.error(error); process.exitCode = 1; });
