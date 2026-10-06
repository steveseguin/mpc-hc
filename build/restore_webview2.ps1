param([ValidatePattern('^\d+\.\d+\.\d+\.\d+$')][string]$Version = '1.0.2903.40')
$ErrorActionPreference = 'Stop'
$packageRoot = Join-Path $PSScriptRoot "..\packages\Microsoft.Web.WebView2.$Version"
if ((Test-Path (Join-Path $packageRoot 'build\native\include\WebView2.h')) -and
    (Test-Path (Join-Path $packageRoot 'build\native\x64\WebView2LoaderStatic.lib')) -and
    (Test-Path (Join-Path $packageRoot 'build\native\x86\WebView2LoaderStatic.lib'))) { return }
New-Item -ItemType Directory -Force -Path $packageRoot | Out-Null
$archivePath = Join-Path $packageRoot 'sdk.zip'
Invoke-WebRequest -UseBasicParsing -Uri "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$Version/microsoft.web.webview2.$Version.nupkg" -OutFile $archivePath
Expand-Archive -LiteralPath $archivePath -DestinationPath $packageRoot -Force
Remove-Item -LiteralPath $archivePath
Write-Output "Restored WebView2 SDK $Version"
