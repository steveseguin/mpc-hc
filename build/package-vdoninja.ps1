param(
    [ValidatePattern('^\d+\.\d+\.\d+-vdoninja\.\d+$')][string]$Version = '2.8.3-vdoninja.1',
    [string]$PlayerDirectory = "$PSScriptRoot\..\bin\mpc-hc_x64",
    [string]$OutputDirectory = "$PSScriptRoot\..\bin\releases",
    [string]$CrtDirectory
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = (Resolve-Path "$PSScriptRoot\..").Path
$player = (Resolve-Path $PlayerDirectory).Path
$commit = git -C $root rev-parse HEAD
$tag = git -C $root describe --tags --exact-match HEAD 2>$null
if ($LASTEXITCODE -ne 0 -or $tag -ne $Version) { throw "Check out the $Version release tag before packaging." }
git -C $root diff --quiet HEAD
if ($LASTEXITCODE -ne 0) { throw 'Commit release changes before packaging.' }

if (!$CrtDirectory) {
    $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    $vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    $CrtDirectory = Get-ChildItem "$vs\VC\Redist\MSVC" -Directory |
        Where-Object { $_.Name -match '^\d+\.' } | Sort-Object { [version]$_.Name } -Descending |
        ForEach-Object { Join-Path $_.FullName 'x64\Microsoft.VC143.CRT' } |
        Where-Object { Test-Path "$_\vcruntime140.dll" } | Select-Object -First 1
}
if (!$CrtDirectory -or !(Test-Path "$CrtDirectory\vcruntime140.dll")) { throw 'Supply the Visual C++ x64 redistributable CRT directory.' }

# Reuse the upstream release's ancillary MediaInfo and MPC Video Renderer
# binaries. The player, icons, translations and LAV Filters come from this build.
$upstreamUrl = 'https://github.com/clsid2/mpc-hc/releases/download/2.8.2/MPC-HC.2.8.2.x64.zip'
$upstreamHash = 'eefee5ac29fc33e6031e34e0e163e157212d272c1bcf576149d40c0c7abb32f4'
$upstreamZip = Join-Path $root 'packages\MPC-HC.2.8.2.x64.zip'
$upstream = Join-Path $root 'packages\mpc-upstream-2.8.2'
if (!(Test-Path $upstreamZip)) {
    New-Item -ItemType Directory -Force (Split-Path $upstreamZip) | Out-Null
    Invoke-WebRequest -UseBasicParsing $upstreamUrl -OutFile $upstreamZip
}
if ((Get-FileHash $upstreamZip).Hash -ne $upstreamHash) { throw 'Upstream ancillary archive SHA256 mismatch.' }
Expand-Archive -LiteralPath $upstreamZip -DestinationPath $upstream -Force

$required = @('mpc-hc64.exe', 'mpciconlib.dll', 'LAVFilters64\LAVVideo.ax',
    'LAVFilters64\LAVAudio.ax', 'LAVFilters64\LAVSplitter.ax',
    'LAVFilters64\libbluray.dll', 'LAVFilters64\IntelQuickSyncDecoder.dll',
    'LAVFilters64\LAVFilters.Dependencies.manifest', 'Lang\mpcresources.fr.dll')
foreach ($file in $required) {
    if (!(Test-Path (Join-Path $player $file))) { throw "Missing release component: $file" }
}
foreach ($library in @('avcodec','avformat','avfilter','avutil','swresample','swscale')) {
    if (!(Get-ChildItem "$player\LAVFilters64\$library-lav-*.dll")) { throw "Missing LAV dependency: $library" }
}
$expectedVersion = ($Version -split '-')[0]
$binaryVersion = (Get-Item "$player\mpc-hc64.exe").VersionInfo
if ($binaryVersion.ProductVersion -notlike "$expectedVersion*VDO.Ninja Edition*" -or
    !$binaryVersion.ProductVersion.Contains($commit.Substring(0,7))) { throw 'Player version or source commit does not match the release.' }

$name = "MPC-HC.$Version.x64"
$stage = Join-Path $OutputDirectory $name
$archive = "$stage.zip"
if ((Test-Path $stage) -or (Test-Path $archive)) { throw 'Release staging/output already exists; use a new output directory.' }
New-Item -ItemType Directory -Force $stage | Out-Null
Copy-Item "$player\mpc-hc64.exe", "$player\mpciconlib.dll" $stage
foreach ($directory in @('LAVFilters64','Lang')) {
    New-Item -ItemType Directory "$stage\$directory" | Out-Null
    Get-ChildItem "$player\$directory" -File | Where-Object { $_.Extension -in @('.dll','.ax','.manifest') } |
        Copy-Item -Destination "$stage\$directory"
}
Copy-Item "$CrtDirectory\*.dll" $stage
Copy-Item "$root\distrib\x64\D3DCompiler_47.dll", "$root\distrib\x64\D3DX9_43.dll" $stage
Copy-Item "$upstream\MediaInfo.dll" $stage
Copy-Item "$upstream\MPCVR", "$upstream\Toolbars" $stage -Recurse
Copy-Item "$root\src\mpc-hc\res\shaders\dx9" "$stage\Shaders" -Recurse
Copy-Item "$root\src\mpc-hc\res\shaders\dx11" "$stage\Shaders11" -Recurse
Copy-Item "$root\COPYING.txt", "$root\docs\Authors.txt", "$root\Readme.md", "$root\distrib\WebView2_LICENSE.txt",
    "$root\distrib\WebView2_NOTICE.txt", "$root\distrib\MediaInfo_LICENSE.txt", "$root\distrib\MPCVR_LICENSE.txt" $stage
Copy-Item "$root\src\thirdparty\LAVFilters\src\COPYING" "$stage\LAVFilters64\COPYING.txt"
# Preserve dependency notices alongside the GPL and WebView2 notices. Read from
# version-controlled files, including the pinned submodule checkouts.
$notices = @(git -C $root ls-files --recurse-submodules) | Where-Object {
    (Split-Path $_ -Leaf) -match '^(COPYING|LICENSE|LICENCE|COPYRIGHT)([._-].*)?$|^FTL\.TXT$'
}
foreach ($notice in ($notices + @('src/thirdparty/zlib/README'))) {
    $destination = Join-Path "$stage\Licenses" $notice
    New-Item -ItemType Directory -Force (Split-Path $destination) | Out-Null
    Copy-Item (Join-Path $root $notice) $destination
}
Copy-Item "$root\docs" "$stage\docs" -Recurse
Copy-Item "$root\docs\releases\$Version.md" "$stage\RELEASE-NOTES.md"
[IO.File]::WriteAllText((Join-Path $stage 'mpc-hc64.ini'), "[Settings]`r`nUpdaterAutoCheck=0`r`n", [Text.Encoding]::ASCII)
$submodules = @(git -C $root submodule status --recursive)
$info = [ordered]@{
    release = $Version; commit = $commit; architecture = 'x64'; playerVersion = $binaryVersion.ProductVersion
    source = "https://github.com/steveseguin/mpc-hc/tree/$Version"
    ancillarySource = $upstreamUrl; ancillarySha256 = $upstreamHash
    mediaInfoVersion = (Get-Item "$stage\MediaInfo.dll").VersionInfo.FileVersion
    mpcVideoRendererVersion = (Get-Item "$stage\MPCVR\MpcVideoRenderer64.ax").VersionInfo.FileVersion
    crtVersion = (Get-Item "$stage\vcruntime140.dll").VersionInfo.FileVersion
    submodules = $submodules
}
$info | ConvertTo-Json -Depth 3 | Set-Content "$stage\BUILD-INFO.json" -Encoding UTF8
$stageFull = (Resolve-Path $stage).Path
$packageFiles = @(Get-ChildItem -LiteralPath $stageFull -File -Recurse | Sort-Object FullName)
$packageFiles | ForEach-Object {
    '{0} *{1}' -f (Get-FileHash -LiteralPath $_.FullName).Hash.ToLowerInvariant(), $_.FullName.Substring($stageFull.Length+1).Replace('\','/')
} | Set-Content "$stage\FILES.sha256" -Encoding ASCII
Compress-Archive -LiteralPath $stage -DestinationPath $archive -CompressionLevel Optimal
'{0} *{1}' -f (Get-FileHash $archive).Hash.ToLowerInvariant(), (Split-Path $archive -Leaf) |
    Set-Content (Join-Path $OutputDirectory "$name.sha256") -Encoding ASCII
Write-Output (Resolve-Path $archive).Path
