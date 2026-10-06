/* SPDX-License-Identifier: GPL-3.0-or-later */
// Standalone host for exercising the shipping WebRTC window without MFC.
#include "WebRTCPlayer.h"
#include <shellapi.h>
#include <cstdio>
#include <memory>

static std::unique_ptr<WebRTC::Player> player;
static LRESULT CALLBACK WindowProc(HWND window, UINT message, WPARAM wparam, LPARAM lparam)
{
    if (message == WM_SIZE && player) {
        RECT bounds;
        GetClientRect(window, &bounds);
        player->SetBounds(bounds);
    } else if (message == WM_APP + 1 && player) player->Play();
    else if (message == WM_APP + 2 && player) player->Pause();
    else if (message == WM_APP + 3 && player) player->Stop();
    else if (message == WM_APP + 4 && player) player->SetVolume(static_cast<long>(lparam));
    else if (message == WM_DESTROY) { player.reset(); PostQuitMessage(0); }
    return DefWindowProcW(window, message, wparam, lparam);
}

int wmain(int argc, wchar_t** argv)
{
    if (argc != 2) return 2;
    if (FAILED(CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED))) return 3;
    WNDCLASSW cls = {};
    cls.lpfnWndProc = WindowProc;
    cls.hInstance = GetModuleHandleW(nullptr);
    cls.lpszClassName = L"MPCWebRTCTestHost";
    RegisterClassW(&cls);
    HWND window = CreateWindowExW(WS_EX_TOOLWINDOW, cls.lpszClassName, L"MPC WebRTC playback validation", WS_OVERLAPPEDWINDOW,
        -10000, -10000, 800, 600, nullptr, nullptr, cls.hInstance, nullptr);
    if (!window) return 4;
    ShowWindow(window, SW_SHOWNOACTIVATE);
    wprintf(L"hwnd:%llu\n", static_cast<unsigned long long>(reinterpret_cast<uintptr_t>(window)));
    fflush(stdout);
    player = std::make_unique<WebRTC::Player>(window, [](const std::wstring& message) {
        wprintf(L"%ls\n", message.c_str());
        fflush(stdout);
    });
    const HRESULT hr = player->Open(argv[1]);
    if (FAILED(hr)) { wprintf(L"Open failed: %08lx\n", hr); return 5; }
    player->Play();
    MSG message;
    while (GetMessageW(&message, nullptr, 0, 0) > 0) {
        TranslateMessage(&message);
        DispatchMessageW(&message);
    }
    CoUninitialize();
    return 0;
}
