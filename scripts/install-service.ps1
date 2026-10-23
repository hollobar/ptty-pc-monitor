# Ptty PC Monitor 센서 서비스 설치 스크립트 / sensor service installer
# - service 폴더(배포용) 또는 ..\dist\service(개발용)의 파일을 C:\Program Files\Ptty PC Monitor 로 복사하고
# - Windows 서비스(LocalSystem, 자동 시작)로 등록한 뒤 시작합니다.
# 관리자 권한이 필요합니다. 일반 권한으로 실행하면 UAC 창을 띄워 다시 실행합니다.
# 메시지는 Windows 표시 언어에 따라 한국어 / English 로 나옵니다.

$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Start-Process powershell.exe -Verb RunAs -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
    exit
}

$messages = @{
    ko = @{
        NotFound   = "서비스 파일(PcMonitorService.exe)을 찾을 수 없습니다.`n설치 폴더의 service 폴더가 있는지 확인하세요."
        NoPawnIO   = "PawnIO 드라이버가 설치되어 있지 않습니다. CPU 온도와 메인보드 팬을 보려면 https://pawnio.eu 에서 설치하세요 (나머지 값은 없어도 표시됩니다)."
        Removing   = "기존 서비스를 중지하고 제거합니다..."
        Legacy     = "이전 버전 폴더 삭제: {0}"
        Copying    = "파일 복사: {0}"
        Registering = "서비스 등록: {0}"
        Description = "Stream Deck Ptty PC Monitor 플러그인용 하드웨어 센서 서비스 (http://localhost:47321)"
        Done       = "설치 완료. 현재 값:"
        Temp       = "온도"
        Load       = "사용량"
        Failed     = "설치 실패: {0}"
        PressEnter = "Enter 키를 누르면 닫힙니다"
    }
    en = @{
        NotFound   = "The service file (PcMonitorService.exe) was not found.`nMake sure the service folder is next to this script."
        NoPawnIO   = "The PawnIO driver is not installed. To see CPU temperature and motherboard fans, install it from https://pawnio.eu (everything else works without it)."
        Removing   = "Stopping and removing the existing service..."
        Legacy     = "Removing the old version's folder: {0}"
        Copying    = "Copying files: {0}"
        Registering = "Registering service: {0}"
        Description = "Hardware sensor service for the Ptty PC Monitor Stream Deck plugin (http://localhost:47321)"
        Done       = "Installed. Current values:"
        Temp       = "temp"
        Load       = "load"
        Failed     = "Installation failed: {0}"
        PressEnter = "Press Enter to close"
    }
}
$lang = (Get-UICulture).TwoLetterISOLanguageName
$m = if ($messages.ContainsKey($lang)) { $messages[$lang] } else { $messages.en }

$serviceName = 'PcMonitorService'
# 배포용 설치 폴더에서는 스크립트 옆의 service 폴더, 개발 폴더에서는 ..\dist\service 를 사용합니다.
$source = @((Join-Path $PSScriptRoot 'service'), (Join-Path $PSScriptRoot '..\dist\service')) |
    Where-Object { Test-Path (Join-Path $_ 'PcMonitorService.exe') } | Select-Object -First 1
$target = Join-Path $env:ProgramFiles 'Ptty PC Monitor'
$exe = Join-Path $target 'PcMonitorService.exe'

try {
    if (-not $source) { throw $m.NotFound }

    if (-not (Get-CimInstance Win32_SystemDriver -Filter "Name='PawnIO'" -ErrorAction SilentlyContinue)) {
        Write-Warning $m.NoPawnIO
    }

    $existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host $m.Removing
        if ($existing.Status -ne 'Stopped') { Stop-Service -Name $serviceName -Force }
        sc.exe delete $serviceName | Out-Null
        Start-Sleep -Seconds 2
    }

    # 이름 변경 전 버전은 C:\Program Files\PC Monitor 에 설치되었습니다.
    $legacy = Join-Path $env:ProgramFiles 'PC Monitor'
    if (Test-Path $legacy) {
        Write-Host ($m.Legacy -f $legacy)
        Remove-Item $legacy -Recurse -Force
    }

    Write-Host ($m.Copying -f $target)
    New-Item -ItemType Directory -Force $target | Out-Null
    Copy-Item (Join-Path $source '*') $target -Recurse -Force

    Write-Host ($m.Registering -f $serviceName)
    sc.exe create $serviceName binPath= "`"$exe`"" start= auto DisplayName= "Ptty PC Monitor Sensor Service" | Out-Null
    sc.exe description $serviceName $m.Description | Out-Null
    # 비정상 종료 시 5초 후 자동 재시작
    sc.exe failure $serviceName reset= 86400 actions= restart/5000/restart/5000/restart/5000 | Out-Null

    Start-Service -Name $serviceName
    Start-Sleep -Seconds 3

    $data = Invoke-RestMethod -Uri 'http://localhost:47321/api/sensors' -TimeoutSec 5
    Write-Host ""
    Write-Host $m.Done -ForegroundColor Green
    Write-Host ("  CPU  {0}  {1} {2}°C  {3} {4}%" -f $data.cpu.name, $m.Temp, $data.cpu.temperature, $m.Load, $data.cpu.load)
    Write-Host ("  GPU  {0}  {1} {2}°C  {3} {4}%" -f $data.gpu.name, $m.Temp, $data.gpu.temperature, $m.Load, $data.gpu.load)
    Write-Host ("  RAM  {0} / {1} GB" -f $data.memory.usedGB, $data.memory.totalGB)
}
catch {
    Write-Host ""
    Write-Host ($m.Failed -f $_) -ForegroundColor Red
}

Write-Host ""
Read-Host $m.PressEnter
