/* SPDX-License-Identifier: GPL-3.0-or-later */
// Make a short H.264/AAC file for packaged DirectShow playback validation.
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
    const browser = await chromium.launch({channel:'msedge', headless:true,
        args:['--autoplay-policy=no-user-gesture-required']});
    try {
        const page = await browser.newPage();
        const bytes = await page.evaluate(async () => {
            const canvas = document.createElement('canvas');
            canvas.width = 640; canvas.height = 360;
            const ctx = canvas.getContext('2d');
            let frame = 0;
            const draw = setInterval(() => {
                ctx.fillStyle = frame++ % 2 ? '#128841' : '#2040bb';
                ctx.fillRect(0,0,640,360);
                ctx.fillStyle = '#fff'; ctx.font = '30px sans-serif';
                ctx.fillText(`MPC normal H.264 playback ${frame}`, 25,100);
            }, 50);
            const audio = new AudioContext();
            const oscillator = audio.createOscillator();
            const gain = audio.createGain(); gain.gain.value = 0.03;
            const output = audio.createMediaStreamDestination();
            oscillator.connect(gain).connect(output); oscillator.start();
            await audio.resume();
            const stream = canvas.captureStream(20);
            stream.addTrack(output.stream.getAudioTracks()[0]);
            const mimeType = 'video/mp4;codecs=avc1.42001E,mp4a.40.2';
            if (!MediaRecorder.isTypeSupported(mimeType)) throw new Error('Edge H.264/AAC recording unavailable');
            const recorder = new MediaRecorder(stream, {mimeType});
            const chunks = [];
            recorder.ondataavailable = event => chunks.push(event.data);
            const stopped = new Promise(resolve => { recorder.onstop = resolve; });
            recorder.start();
            await new Promise(resolve => setTimeout(resolve, 8000));
            recorder.stop(); await stopped;
            clearInterval(draw); stream.getTracks().forEach(track => track.stop());
            await audio.close();
            return [...new Uint8Array(await new Blob(chunks).arrayBuffer())];
        });
        const filename = path.resolve(process.argv[2] || 'bin/webrtc-tests/normal-h264.mp4');
        fs.mkdirSync(path.dirname(filename), {recursive:true});
        fs.writeFileSync(filename, Buffer.from(bytes));
        console.log(filename);
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
