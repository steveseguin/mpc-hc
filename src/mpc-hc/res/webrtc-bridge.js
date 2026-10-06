/* SPDX-License-Identifier: GPL-3.0-or-later */
(() => {
    if (window !== window.top || !window.chrome?.webview) return;
    let playing = false;
    let volume = 1;
    let lastSize = "";
    const known = new WeakSet();
    const send = text => window.chrome.webview.postMessage(text);
    const media = () => [...document.querySelectorAll("video,audio")];
    function apply() {
        // VDO.Ninja also uses Web Audio; its API updates that path and retains
        // the level across newly arriving peers and asynchronous WHEP handoffs.
        if (typeof window.setSessionPlaybackVolume === "function") {
            window.setSessionPlaybackVolume(playing ? volume : 0, "*");
        } else if (location.origin !== "null") {
            window.postMessage({volume: playing ? volume : 0}, location.origin);
        }
        for (const element of media()) {
            if (element.dataset.keepVolume !== "1") element.volume = playing ? volume : 0;
            if (playing) element.play().catch(() => {});
            else element.pause();
        }
    }
    function discover() {
        for (const element of media()) {
            if (!known.has(element)) {
                known.add(element);
                element.addEventListener("play", () => {
                    element.volume = playing ? volume : 0;
                    if (!playing) element.pause();
                });
                element.volume = playing ? volume : 0;
                if (!playing) element.pause();
            }
        }
        const video = media().find(element => element.videoWidth > 0 && element.videoHeight > 0);
        if (video) {
            const size = `size:${video.videoWidth}:${video.videoHeight}`;
            if (size !== lastSize) { lastSize = size; send(size); }
        }
    }
    window.chrome.webview.addEventListener("message", event => {
        const command = event.data;
        if (command.type !== "state") return;
        playing = command.playing === true;
        volume = Math.max(0, Math.min(1, Number(command.volume) || 0));
        apply();
    });
    window.addEventListener("DOMContentLoaded", () => {
        discover();
        new MutationObserver(discover).observe(document.documentElement, {childList: true, subtree: true});
        setInterval(discover, 500);
        send("ready");
    }, {once: true});
})();
