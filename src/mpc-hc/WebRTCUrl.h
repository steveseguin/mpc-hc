/* SPDX-License-Identifier: GPL-3.0-or-later */
#pragma once

#include <algorithm>
#include <string>

namespace WebRTC {
enum class UrlKind { None, VDONinja, WHEP };

struct PlaybackUrl {
    UrlKind kind = UrlKind::None;
    std::wstring url;
};

inline std::wstring LowerASCII(std::wstring text)
{
    for (auto& c : text) {
        if (c >= L'A' && c <= L'Z') c += L'a' - L'A';
    }
    return text;
}

// Explicit schemes also allow self-hosted VDO.Ninja and WHEP endpoints whose
// path does not identify the protocol. Never lowercase opaque stream IDs/tokens.
inline PlaybackUrl ParseUrl(std::wstring url)
{
    const auto first = url.find_first_not_of(L" \t\r\n");
    if (first == std::wstring::npos) return {};
    url = url.substr(first, url.find_last_not_of(L" \t\r\n") - first + 1);
    if (url.find_first_of(L"\r\n\t\\") != std::wstring::npos) return {};
    auto colon = url.find(L':');
    if (colon == std::wstring::npos) return {};
    const auto scheme = LowerASCII(url.substr(0, colon));
    UrlKind explicitKind = UrlKind::None;
    if (scheme == L"whep" || scheme == L"wheps" || scheme == L"whep+https") {
        explicitKind = UrlKind::WHEP;
        url = L"https" + url.substr(colon);
    } else if (scheme == L"whep+http") {
        explicitKind = UrlKind::WHEP;
        url = L"http" + url.substr(colon);
    } else if (scheme == L"vdoninja+https" || scheme == L"vdoninja+http") {
        explicitKind = UrlKind::VDONinja;
        url = (scheme == L"vdoninja+https" ? L"https" : L"http") + url.substr(colon);
    } else if (scheme != L"https" && scheme != L"http") {
        return {};
    }
    colon = url.find(L':');
    if (url.substr(colon, 3) != L"://") return {};
    const auto hostStart = colon + 3;
    auto hostEnd = url.find_first_of(L"/?#", hostStart);
    if (hostEnd == std::wstring::npos) hostEnd = url.size();
    auto authority = LowerASCII(url.substr(hostStart, hostEnd - hostStart));
    if (authority.empty() || authority.find_first_of(L"@ %") != std::wstring::npos) return {};
    if (explicitKind != UrlKind::None) return { explicitKind, url };
    auto host = authority.substr(0, authority.find(L':'));
    auto domain = [&](const std::wstring& name) {
        return host == name || (host.size() > name.size() &&
            host.compare(host.size() - name.size() - 1, name.size() + 1, L"." + name) == 0);
    };
    const auto pathEnd = url.find_first_of(L"?#", hostEnd);
    auto path = LowerASCII(url.substr(hostEnd, pathEnd - hostEnd));
    if (!path.empty() && path.back() == L'/') path.pop_back();
    // Avoid sending protocol endpoints through playlist sniffing or yt-dlp.
    if ((path.size() >= 5 && path.compare(path.size() - 5, 5, L"/whep") == 0) ||
        (domain(L"meshcast.io") && path.rfind(L"/whep/", 0) == 0)) {
        return { UrlKind::WHEP, url };
    }
    if (domain(L"vdo.ninja") || domain(L"obs.ninja")) {
        return { UrlKind::VDONinja, url };
    }
    return {};
}
}
