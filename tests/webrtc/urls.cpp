/* SPDX-License-Identifier: GPL-3.0-or-later */
#include "WebRTCUrl.h"
#include <cassert>
#include <iostream>

int main()
{
    using namespace WebRTC;
    assert(ParseUrl(L"https://vdo.ninja/?view=CaseSensitive&password=A%26B").kind == UrlKind::VDONinja);
    assert(ParseUrl(L" HTTPS://BETA.VDO.NINJA/?view=AbCd ").url == L"HTTPS://BETA.VDO.NINJA/?view=AbCd");
    assert(ParseUrl(L"https://obs.ninja/?view=test").kind == UrlKind::VDONinja);
    assert(ParseUrl(L"vdoninja+http://localhost:8080/?view=test").url == L"http://localhost:8080/?view=test");
    assert(ParseUrl(L"https://meshcast.io/live/AbCd/whep?token=A%2FB").kind == UrlKind::WHEP);
    assert(ParseUrl(L"https://region.meshcast.io/whep/AbCd").kind == UrlKind::WHEP);
    assert(ParseUrl(L"whep://example.com/opaque?case=AbCd#token=secret").url == L"https://example.com/opaque?case=AbCd#token=secret");
    assert(ParseUrl(L"whep+http://127.0.0.1:8889/stream/whep").url == L"http://127.0.0.1:8889/stream/whep");
    assert(ParseUrl(L"wheps://[::1]:8443/live").url == L"https://[::1]:8443/live");
    assert(ParseUrl(L"https://example.com/whep/").kind == UrlKind::WHEP);
    for (auto url : {L"", L"https://vdo.ninja.evil.test/?view=x", L"https://fakevdo.ninja/?view=x",
        L"https://vdo.ninja@evil.test/?view=x", L"https://evil.test/?next=vdo.ninja",
        L"https://example.com/movie.mp4", L"https://example.com/watch?whep=1", L"https://meshcast.io.evil.test/whep/AbCd", L"C:\\media\\movie.mkv",
        L"file:///C:/vdo.ninja.html", L"javascript:alert(1)", L"whep:opaque", L"whep:///path", L"https://vdo.ninja\\@evil.test"}) {
        assert(ParseUrl(url).kind == UrlKind::None);
    }
    std::cout << "URL routing checks passed\n";
}
