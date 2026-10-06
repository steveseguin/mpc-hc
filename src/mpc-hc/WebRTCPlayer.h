/* SPDX-License-Identifier: GPL-3.0-or-later */
#pragma once

#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <functional>
#include <memory>
#include <string>

namespace WebRTC {
// All calls and callbacks run on the owning STA/UI thread. The implementation
// deliberately has no dependency on MFC or the DirectShow filter graph.
class Player {
public:
    using Event = std::function<void(const std::wstring&)>;
    Player(HWND parent, Event event);
    ~Player();
    Player(const Player&) = delete;
    Player& operator=(const Player&) = delete;
    HRESULT Open(const std::wstring& url);
    void Play();
    void Pause();
    void Stop();
    void SetVolume(long volume);
    void SetBounds(const RECT& bounds);
    void SetVisible(bool visible);
private:
    struct State;
    std::shared_ptr<State> m_state;
};
}
