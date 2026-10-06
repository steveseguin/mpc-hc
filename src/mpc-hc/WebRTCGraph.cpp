/* SPDX-License-Identifier: GPL-3.0-or-later */
#include "stdafx.h"
#include "WebRTCGraph.h"

using namespace DSObjects;

CWebRTCGraph::CWebRTCGraph(HWND parent, HRESULT& hr)
{
    hr = S_OK;
    if (!m_window.Create(nullptr, nullptr, WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS | WS_CLIPCHILDREN,
        CRect(0, 0, 0, 0), CWnd::FromHandle(parent), 0)) {
        hr = E_FAIL;
        return;
    }
    m_player = std::make_unique<WebRTC::Player>(m_window.m_hWnd,
        [this](const std::wstring& message) { OnEvent(message); });
}

CWebRTCGraph::~CWebRTCGraph()
{
    m_player.reset();
    m_window.DestroyWindow();
    ClearMessageQueue();
}

void CWebRTCGraph::OnEvent(const std::wstring& message)
{
    if (message.compare(0, 5, L"size:") == 0) {
        long width = 0, height = 0;
        if (swscanf_s(message.c_str(), L"size:%ld:%ld", &width, &height) == 2 &&
            width > 0 && height > 0 && width <= 16384 && height <= 16384 &&
            (width != m_width || height != m_height)) {
            m_width = width;
            m_height = height;
            NotifyEvent(EC_VIDEO_SIZE_CHANGED, MAKELPARAM(width, height));
        }
    } else if (message.compare(0, 6, L"error:") == 0) {
        const auto text = message.substr(6);
        // EC_BG_ERROR's existing consumer expects an ANSI string.
        const CW2A converted(text.c_str());
        const size_t size = strlen(converted) + 1;
        auto copy = static_cast<char*>(CoTaskMemAlloc(size));
        if (copy) {
            strcpy_s(copy, size, converted);
            NotifyEvent(EC_BG_ERROR, reinterpret_cast<LONG_PTR>(copy));
        }
    }
}

STDMETHODIMP CWebRTCGraph::RenderFile(LPCWSTR file, LPCWSTR)
{
    if (!file) return E_POINTER;
    return m_player ? m_player->Open(file) : E_UNEXPECTED;
}
STDMETHODIMP CWebRTCGraph::Run() { m_player->Play(); m_state = State_Running; return S_OK; }
STDMETHODIMP CWebRTCGraph::Pause() { m_player->Pause(); m_state = State_Paused; return S_OK; }
STDMETHODIMP CWebRTCGraph::Stop() { m_player->Stop(); m_state = State_Stopped; return S_OK; }
STDMETHODIMP CWebRTCGraph::GetState(LONG, OAFilterState* state)
{
    if (!state) return E_POINTER;
    *state = m_state;
    return S_OK;
}
STDMETHODIMP CWebRTCGraph::GetCapabilities(DWORD* capabilities)
{
    if (!capabilities) return E_POINTER;
    *capabilities = 0; // A live stream has no seekable timeline.
    return S_OK;
}
STDMETHODIMP CWebRTCGraph::GetDuration(LONGLONG* duration)
{
    if (!duration) return E_POINTER;
    *duration = 0;
    return S_OK;
}
STDMETHODIMP CWebRTCGraph::GetCurrentPosition(LONGLONG* position)
{
    if (!position) return E_POINTER;
    *position = 0;
    return S_OK;
}
STDMETHODIMP CWebRTCGraph::put_Visible(long visible)
{
    m_visible = visible != OAFALSE;
    m_player->SetVisible(m_visible);
    return S_OK;
}
STDMETHODIMP CWebRTCGraph::get_Visible(long* visible)
{
    if (!visible) return E_POINTER;
    *visible = m_visible ? OATRUE : OAFALSE;
    return S_OK;
}
STDMETHODIMP CWebRTCGraph::put_Owner(OAHWND owner)
{
    if (owner) {
        ::SetParent(m_window.m_hWnd, reinterpret_cast<HWND>(owner));
    } else {
        m_window.ShowWindow(SW_HIDE);
    }
    return S_OK;
}
STDMETHODIMP CWebRTCGraph::SetWindowPosition(long left, long top, long width, long height)
{
    m_window.MoveWindow(left, top, width, height);
    return S_OK;
}
STDMETHODIMP CWebRTCGraph::SetDestinationPosition(long left, long top, long width, long height)
{
    m_player->SetBounds(RECT{left, top, left + width, top + height});
    return S_OK;
}
STDMETHODIMP CWebRTCGraph::GetVideoSize(long* width, long* height)
{
    if (!width || !height) return E_POINTER;
    *width = m_width;
    *height = m_height;
    return S_OK;
}
STDMETHODIMP CWebRTCGraph::put_Volume(long volume)
{
    if (volume < -10000 || volume > 0) return E_INVALIDARG;
    m_volume = volume;
    m_player->SetVolume(volume);
    return S_OK;
}
STDMETHODIMP CWebRTCGraph::get_Volume(long* volume)
{
    if (!volume) return E_POINTER;
    *volume = m_volume;
    return S_OK;
}
STDMETHODIMP_(engine_t) CWebRTCGraph::GetEngine() { return WebRTCPlayback; }
