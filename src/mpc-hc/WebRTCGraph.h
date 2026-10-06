/* SPDX-License-Identifier: GPL-3.0-or-later */
#pragma once
#include "BaseGraph.h"
#include "WebRTCPlayer.h"

namespace DSObjects {
class CWebRTCGraph : public CBaseGraph {
    CPlayerWindow m_window;
    std::unique_ptr<WebRTC::Player> m_player;
    OAFilterState m_state = State_Stopped;
    long m_volume = 0;
    long m_width = 1280;
    long m_height = 720;
    bool m_visible = true;
    void OnEvent(const std::wstring& message);
public:
    CWebRTCGraph(HWND parent, HRESULT& hr);
    ~CWebRTCGraph() override;
protected:
    STDMETHODIMP RenderFile(LPCWSTR file, LPCWSTR playlist) override;
    STDMETHODIMP Run() override;
    STDMETHODIMP Pause() override;
    STDMETHODIMP Stop() override;
    STDMETHODIMP GetState(LONG timeout, OAFilterState* state) override;
    STDMETHODIMP GetCapabilities(DWORD* capabilities) override;
    STDMETHODIMP GetDuration(LONGLONG* duration) override;
    STDMETHODIMP GetCurrentPosition(LONGLONG* position) override;
    STDMETHODIMP put_Visible(long visible) override;
    STDMETHODIMP get_Visible(long* visible) override;
    STDMETHODIMP put_Owner(OAHWND owner) override;
    STDMETHODIMP SetWindowPosition(long left, long top, long width, long height) override;
    STDMETHODIMP SetDestinationPosition(long left, long top, long width, long height) override;
    STDMETHODIMP GetVideoSize(long* width, long* height) override;
    STDMETHODIMP put_Volume(long volume) override;
    STDMETHODIMP get_Volume(long* volume) override;
    STDMETHODIMP_(engine_t) GetEngine() override;
};
}
