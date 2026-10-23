# 다른 PC에 설치할 수 있는 배포 패키지를 만듭니다.
#   결과: dist\PttyPCMonitor-Setup-v<버전>\ 폴더와 dist\PttyPCMonitor-Setup-v<버전>.zip
#         버전은 plugin\...sdPlugin\manifest.json 의 "Version" (예: 1.0.0.0 -> v1.0.0, GitHub 태그와 같은 형식)
#   내용: Stream Deck 플러그인(.streamDeckPlugin), 센서 서비스, 설치/제거 스크립트, INSTALL(.ko).txt,
#         LICENSE / THIRD-PARTY-NOTICES.md / licenses\ (패키지 루트, 플러그인 안, 서비스 폴더에 모두 포함)
# 사용: powershell -ExecutionPolicy Bypass -File scripts\build-package.ps1

$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$dist = Join-Path $root 'dist'
$sdPlugin = Join-Path $root 'plugin\com.hollobar.ptty-pc-monitor.sdPlugin'

# The release version comes from the plugin manifest: Stream Deck uses four parts (1.0.0.0), release tags use
# three (v1.0.0), so the fourth part is dropped.
$manifest = Get-Content (Join-Path $sdPlugin 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$versionParts = "$($manifest.Version)".Split('.')
if ($versionParts.Count -lt 3 -or ($versionParts | Where-Object { $_ -notmatch '^\d+$' })) {
    throw "manifest.json 의 Version 형식이 올바르지 않습니다: '$($manifest.Version)' (예: 1.0.0.0)"
}
$version = 'v' + ($versionParts[0..2] -join '.')
$packageName = "PttyPCMonitor-Setup-$version"
$package = Join-Path $dist $packageName

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }

Step "버전 $version ($packageName.zip)"

# This project's license plus the full license texts of the bundled third-party components. They ship with every
# distributed part (zip root, the .streamDeckPlugin, the installed service folder), since each can travel on its own.
$legalFiles = @((Join-Path $root 'LICENSE'), (Join-Path $root 'THIRD-PARTY-NOTICES.md'), (Join-Path $root 'licenses'))
function Copy-Legal($destination) {
    foreach ($item in $legalFiles) { Copy-Item $item $destination -Recurse -Force }
}
function Run($exe, [string[]]$arguments) {
    & $exe @arguments
    if ($LASTEXITCODE -ne 0) { throw "$exe $($arguments -join ' ') 실패 (exit $LASTEXITCODE)" }
}

# The plugin may be running the helper; publishing over a running exe fails.
Get-Process pcmonitor-helper -ErrorAction SilentlyContinue | Stop-Process -Force

Step '센서 서비스 빌드'
Run dotnet @('publish', (Join-Path $root 'service\PcMonitor.Service'), '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true',
    '-p:PublishSingleFile=true', '-p:IncludeNativeLibrariesForSelfExtract=true', '-o', (Join-Path $dist 'service'), '--nologo', '-v', 'q')

Step 'helper 빌드 (모니터 제어 / 이미지 디코딩)'
Run dotnet @('publish', (Join-Path $root 'helper\PcMonitor.Helper'), '-c', 'Release', '-o', (Join-Path $sdPlugin 'bin'), '--nologo', '-v', 'q')

Step '플러그인 빌드 및 패키징'
Push-Location (Join-Path $root 'plugin')
try {
    Run npm @('run', 'build', '--silent')
    # Old development logs shouldn't ship.
    Remove-Item (Join-Path $sdPlugin 'logs') -Recurse -Force -ErrorAction SilentlyContinue
    # Copies only for packing (ignored by git; see plugin/.gitignore).
    Copy-Legal $sdPlugin
    Run npx @('streamdeck', 'pack', 'com.hollobar.ptty-pc-monitor.sdPlugin', '--output', $dist, '--force', '--no-file-list')
}
finally {
    Pop-Location
    # The development copy runs through a `streamdeck link` junction into this (non-ASCII) folder, where Node's
    # recursive mkdir of "logs" fails with ENOENT and the plugin exits at startup. An existing folder avoids it.
    New-Item -ItemType Directory -Force (Join-Path $sdPlugin 'logs') | Out-Null
}

Step '설치 폴더 구성'
if (Test-Path $package) { Remove-Item $package -Recurse -Force }
New-Item -ItemType Directory -Force (Join-Path $package 'service') | Out-Null
Copy-Item (Join-Path $dist 'com.hollobar.ptty-pc-monitor.streamDeckPlugin') $package
Copy-Item (Join-Path $dist 'service\PcMonitorService.exe'), (Join-Path $dist 'service\appsettings.json') (Join-Path $package 'service')
Copy-Legal $package
# install-service copies the service folder to Program Files, so the notices end up next to the installed exe.
Copy-Legal (Join-Path $package 'service')
foreach ($name in 'install-service.cmd', 'install-service.ps1', 'uninstall-service.cmd', 'uninstall-service.ps1', 'INSTALL.txt', 'INSTALL.ko.txt') {
    $source = Join-Path $PSScriptRoot $name
    $dest = Join-Path $package $name
    if ($name -like '*.ps1' -or $name -like '*.txt') {
        # Windows PowerShell 5.1 reads BOM-less scripts as ANSI, which garbles Korean text.
        $text = [IO.File]::ReadAllText($source, [Text.Encoding]::UTF8)
        [IO.File]::WriteAllText($dest, $text, (New-Object Text.UTF8Encoding $true))
    }
    else {
        Copy-Item $source $dest
    }
}

Step '압축'
$zip = Join-Path $dist "$packageName.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
# Windows' bsdtar instead of Compress-Archive / ZipFile: in Windows PowerShell 5.1 those write "\" path
# separators, which other unzip tools mangle.
Run tar.exe @('-a', '-c', '-f', $zip, '-C', $dist, (Split-Path $package -Leaf))

Write-Host "`n완료: $zip" -ForegroundColor Green
Get-ChildItem $package -Recurse -File | ForEach-Object {
    '{0,-50} {1,8:N1} MB' -f $_.FullName.Substring($package.Length + 1), ($_.Length / 1MB)
}
