/* SPDX-License-Identifier: GPL-3.0-or-later */
#include "WebRTCPlayer.h"
#include "WebRTCUrl.h"
#include <WebView2.h>
#include <WebView2EnvironmentOptions.h>
#include <wrl.h>
#include <shlobj.h>
#include <algorithm>
#include <cmath>
#include <sstream>
#include <locale>

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;
using namespace WebRTC;

namespace {
std::wstring Resource(const wchar_t* name)
{
    const auto module = GetModuleHandleW(nullptr);
    const auto resource = FindResourceW(module, name, RT_RCDATA);
    const auto data = resource ? LoadResource(module, resource) : nullptr;
    const auto bytes = data ? static_cast<const char*>(LockResource(data)) : nullptr;
    const auto size = resource ? SizeofResource(module, resource) : 0;
    if (!bytes || !size) return {};
    const int count = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, bytes, size, nullptr, 0);
    std::wstring text(count, L'\0');
    MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, bytes, size, &text[0], count);
    return text;
}

std::wstring JsonString(const std::wstring& value)
{
    std::wstring result = L"\"";
    const wchar_t* hex = L"0123456789abcdef";
    for (wchar_t c : value) {
        if (c == L'"' || c == L'\\') { result += L'\\'; result += c; }
        else if (c < 32) {
            result += L"\\u00";
            result += hex[(c >> 4) & 15];
            result += hex[c & 15];
        } else result += c;
    }
    return result + L'"';
}
}

struct Player::State : public std::enable_shared_from_this<Player::State> {
    HWND parent;
    Event event;
    PlaybackUrl source;
    ComPtr<ICoreWebView2Controller> controller;
    ComPtr<ICoreWebView2> web;
    RECT bounds = {};
    bool visible = true;
    bool playing = false;
    bool stopped = true;
    bool initializing = false;
    bool ready = false;
    bool closed = false;
    bool loadingWHEP = false;
    long volume = 0;
    std::wstring bridge;
    std::wstring whep;

    void Error(const wchar_t* message) {
        if (!closed && event) event(std::wstring(L"error:") + message);
    }

    void Apply() {
        if (!web || !ready) return;
        const double level = volume <= -10000 ? 0.0 : std::pow(10.0, volume / 2000.0);
        std::wostringstream json;
        json.imbue(std::locale::classic());
        json << L"{\"type\":\"state\",\"playing\":" << (playing ? L"true" : L"false")
            << L",\"volume\":" << level << L"}";
        web->PostWebMessageAsJson(json.str().c_str());
    }

    void OpenWHEP() {
        const auto command = L"{\"type\":\"open\",\"url\":" + JsonString(source.url) + L"}";
        web->PostWebMessageAsJson(command.c_str());
    }

    HRESULT Navigate() {
        if (!web || stopped || closed) return S_OK;
        ready = false;
        if (source.kind == UrlKind::WHEP) {
            loadingWHEP = true;
            return web->NavigateToString(whep.c_str());
        }
        return web->Navigate(source.url.c_str());
    }

    HRESULT Initialize() {
        if (initializing || web) return S_OK;
        bridge = Resource(L"WEBRTC_BRIDGE");
        whep = Resource(L"WEBRTC_WHEP");
        if (bridge.empty() || whep.empty()) return HRESULT_FROM_WIN32(ERROR_RESOURCE_DATA_NOT_FOUND);
        wchar_t folder[MAX_PATH] = {};
        HRESULT hr = SHGetFolderPathW(nullptr, CSIDL_LOCAL_APPDATA | CSIDL_FLAG_CREATE, nullptr, 0, folder);
        if (FAILED(hr)) return hr;
        const std::wstring profile = std::wstring(folder) + L"\\MPC-HC\\WebRTC";
        auto options = Microsoft::WRL::Make<CoreWebView2EnvironmentOptions>();
        options->put_AdditionalBrowserArguments(L"--autoplay-policy=no-user-gesture-required");
        initializing = true;
        const std::weak_ptr<State> weak = shared_from_this();
        hr = CreateCoreWebView2EnvironmentWithOptions(nullptr, profile.c_str(), options.Get(),
            Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
                [weak](HRESULT result, ICoreWebView2Environment* environment) -> HRESULT {
                    auto self = weak.lock();
                    if (!self || self->closed) return S_OK;
                    if (FAILED(result) || !environment) {
                        self->initializing = false;
                        self->Error(L"WebRTC playback requires the Microsoft Edge WebView2 Runtime.");
                        return S_OK;
                    }
                    const HRESULT created = environment->CreateCoreWebView2Controller(self->parent,
                        Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                            [weak](HRESULT result, ICoreWebView2Controller* controller) -> HRESULT {
                                auto self = weak.lock();
                                if (!self || self->closed) {
                                    if (controller) controller->Close();
                                    return S_OK;
                                }
                                self->initializing = false;
                                if (FAILED(result) || !controller) {
                                    self->Error(L"Unable to create the WebRTC playback window.");
                                    return S_OK;
                                }
                                self->controller = controller;
                                controller->get_CoreWebView2(&self->web);
                                if (!self->web) {
                                    self->Error(L"Unable to initialize WebRTC playback.");
                                    return S_OK;
                                }
                                controller->put_Bounds(self->bounds);
                                controller->put_IsVisible(self->visible);
                                self->Configure();
                                return S_OK;
                            }).Get());
                    if (FAILED(created)) {
                        self->initializing = false;
                        self->Error(L"Unable to create the WebRTC playback window.");
                    }
                    return S_OK;
                }).Get());
        if (FAILED(hr)) initializing = false;
        return hr;
    }

    void Configure() {
        ComPtr<ICoreWebView2Settings> settings;
        if (SUCCEEDED(web->get_Settings(&settings))) {
            settings->put_AreDefaultContextMenusEnabled(FALSE);
            settings->put_IsStatusBarEnabled(FALSE);
            settings->put_AreDevToolsEnabled(FALSE);
            settings->put_IsZoomControlEnabled(FALSE);
        }
        const std::weak_ptr<State> weak = shared_from_this();
        EventRegistrationToken token;
        // Playback is receive-only. Do not grant pages camera, microphone,
        // location, clipboard, or notification access, including saved grants.
        web->add_PermissionRequested(Callback<ICoreWebView2PermissionRequestedEventHandler>(
            [](ICoreWebView2*, ICoreWebView2PermissionRequestedEventArgs* args) -> HRESULT {
                return args->put_State(COREWEBVIEW2_PERMISSION_STATE_DENY);
            }).Get(), &token);
        web->add_NewWindowRequested(Callback<ICoreWebView2NewWindowRequestedEventHandler>(
            [](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args) -> HRESULT {
                return args->put_Handled(TRUE);
            }).Get(), &token);
        web->add_NavigationStarting(Callback<ICoreWebView2NavigationStartingEventHandler>(
            [weak](ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* args) -> HRESULT {
                auto self = weak.lock();
                if (!self || self->closed) return args->put_Cancel(TRUE);
                LPWSTR raw = nullptr;
                args->get_Uri(&raw);
                const std::wstring url = raw ? raw : L"";
                CoTaskMemFree(raw);
                const auto lower = LowerASCII(url);
                // NavigateToString reports a data URI at NavigationStarting,
                // although the resulting document's URL is about:blank.
                const bool inlinePage = self->loadingWHEP && lower.rfind(L"data:text/html", 0) == 0;
                self->loadingWHEP = false;
                if (!inlinePage && lower != L"about:blank" && lower.rfind(L"https://", 0) != 0 && lower.rfind(L"http://", 0) != 0) {
                    return args->put_Cancel(TRUE);
                }
                self->ready = false;
                return S_OK;
            }).Get(), &token);
        web->add_NavigationCompleted(Callback<ICoreWebView2NavigationCompletedEventHandler>(
            [weak](ICoreWebView2*, ICoreWebView2NavigationCompletedEventArgs* args) -> HRESULT {
                auto self = weak.lock();
                if (!self || self->closed || self->stopped) return S_OK;
                BOOL success = FALSE;
                args->get_IsSuccess(&success);
                COREWEBVIEW2_WEB_ERROR_STATUS status;
                args->get_WebErrorStatus(&status);
                if (!success && status != COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED) {
                    self->Error(L"Unable to load the WebRTC viewer. Check the URL and network connection.");
                }
                return S_OK;
            }).Get(), &token);
        web->add_ProcessFailed(Callback<ICoreWebView2ProcessFailedEventHandler>(
            [weak](ICoreWebView2*, ICoreWebView2ProcessFailedEventArgs*) -> HRESULT {
                auto self = weak.lock();
                if (self) self->Error(L"The WebRTC playback process stopped. Reopen the stream to reconnect.");
                return S_OK;
            }).Get(), &token);
        web->add_WebMessageReceived(Callback<ICoreWebView2WebMessageReceivedEventHandler>(
            [weak](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
                auto self = weak.lock();
                if (!self || self->closed || self->stopped) return S_OK;
                LPWSTR raw = nullptr;
                if (FAILED(args->TryGetWebMessageAsString(&raw))) return S_OK;
                std::wstring message = raw ? raw : L"";
                CoTaskMemFree(raw);
                if (message == L"ready") {
                    // At this point both the bridge and WHEP command listener
                    // exist. Queueing commands earlier would silently drop them.
                    self->ready = true;
                    self->Apply();
                    if (self->source.kind == UrlKind::WHEP) {
                        self->OpenWHEP();
                    }
                } else if (message.size() <= 2048 && self->event) {
                    self->event(message);
                }
                return S_OK;
            }).Get(), &token);
        HRESULT hr = web->AddScriptToExecuteOnDocumentCreated(bridge.c_str(),
            Callback<ICoreWebView2AddScriptToExecuteOnDocumentCreatedCompletedHandler>(
                [weak](HRESULT result, LPCWSTR) -> HRESULT {
                    auto self = weak.lock();
                    if (!self || self->closed) return S_OK;
                    if (FAILED(result) || FAILED(self->Navigate())) self->Error(L"Unable to start WebRTC playback.");
                    return S_OK;
                }).Get());
        if (FAILED(hr)) Error(L"Unable to initialize WebRTC playback controls.");
    }
};

Player::Player(HWND parent, Event event) : m_state(std::make_shared<State>())
{
    m_state->parent = parent;
    m_state->event = std::move(event);
    GetClientRect(parent, &m_state->bounds);
}

Player::~Player()
{
    m_state->closed = true;
    m_state->event = {};
    if (m_state->controller) m_state->controller->Close();
    m_state->web.Reset();
    m_state->controller.Reset();
}

HRESULT Player::Open(const std::wstring& url)
{
    auto parsed = ParseUrl(url);
    if (parsed.kind == UrlKind::None) return E_INVALIDARG;
    m_state->source = std::move(parsed);
    m_state->stopped = false;
    if (m_state->web) return m_state->Navigate();
    return m_state->Initialize();
}

void Player::Play()
{
    m_state->playing = true;
    if (m_state->stopped) {
        m_state->stopped = false;
        if (m_state->ready && m_state->source.kind == UrlKind::WHEP) {
            m_state->OpenWHEP();
        } else if (FAILED(m_state->Navigate())) {
            m_state->Error(L"Unable to reopen WebRTC stream.");
        }
    }
    m_state->Apply();
}

void Player::Pause()
{
    m_state->playing = false;
    m_state->Apply();
}

void Player::Stop()
{
    m_state->playing = false;
    m_state->stopped = true;
    m_state->Apply();
    if (m_state->web) {
        if (m_state->source.kind == UrlKind::WHEP) {
            // Keep the receiver alive to DELETE a session whose POST response
            // arrives after Stop. The peer itself closes immediately.
            m_state->web->PostWebMessageAsJson(L"{\"type\":\"stop\"}");
        } else {
            m_state->ready = false;
            m_state->web->Navigate(L"about:blank");
        }
    }
}

void Player::SetVolume(long volume)
{
    m_state->volume = (std::max)(-10000L, (std::min)(0L, volume));
    m_state->Apply();
}

void Player::SetBounds(const RECT& bounds)
{
    m_state->bounds = bounds;
    if (m_state->controller) {
        m_state->controller->put_Bounds(bounds);
        m_state->controller->NotifyParentWindowPositionChanged();
    }
}

void Player::SetVisible(bool visible)
{
    m_state->visible = visible;
    if (m_state->controller) m_state->controller->put_IsVisible(visible);
}
