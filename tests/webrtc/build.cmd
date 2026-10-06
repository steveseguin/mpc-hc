@echo off
setlocal
cd /d "%~dp0..\.."
if not defined VSCMD_VER (
  for /f "usebackq tokens=*" %%i in (`"%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "WEBRTCVS=%%i"
)
if not defined VSCMD_VER if defined WEBRTCVS call "%WEBRTCVS%\VC\Auxiliary\Build\vcvars64.bat"
if not defined VSCMD_VER exit /b 1
if errorlevel 1 exit /b %errorlevel%
if not exist bin\webrtc-tests mkdir bin\webrtc-tests
set "WEBRTCSDK=packages\Microsoft.Web.WebView2.1.0.2903.40\build\native"
cl /nologo /EHsc /std:c++17 /W4 /MT /DUNICODE /D_UNICODE /DNOMINMAX /I src\mpc-hc tests\webrtc\urls.cpp /Fo:bin\webrtc-tests\urls.obj /Fe:bin\webrtc-tests\urls.exe
if errorlevel 1 exit /b %errorlevel%
bin\webrtc-tests\urls.exe
if errorlevel 1 exit /b %errorlevel%
pushd src\mpc-hc
rc /nologo /fo ..\..\bin\webrtc-tests\resources.res WebRTCResources.rc
popd
if errorlevel 1 exit /b %errorlevel%
cl /nologo /EHsc /std:c++17 /W4 /MT /DUNICODE /D_UNICODE /DNOMINMAX /I src\mpc-hc /I "%WEBRTCSDK%\include" tests\webrtc\host.cpp src\mpc-hc\WebRTCPlayer.cpp /Fo:bin\webrtc-tests\ /Fe:bin\webrtc-tests\host.exe /link bin\webrtc-tests\resources.res "%WEBRTCSDK%\x64\WebView2LoaderStatic.lib" user32.lib ole32.lib oleaut32.lib shell32.lib version.lib shlwapi.lib advapi32.lib
exit /b %errorlevel%
