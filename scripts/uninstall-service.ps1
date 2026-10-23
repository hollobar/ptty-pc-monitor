# Ptty PC Monitor 센서 서비스 제거 스크립트 / sensor service uninstaller
# 관리자 권한이 필요합니다. 메시지는 Windows 표시 언어에 따라 한국어 / English 로 나옵니다.

$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Start-Process powershell.exe -Verb RunAs -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
    exit
}

$messages = @{
    ko = @{ Removed = "서비스를 제거했습니다."; NotInstalled = "설치된 서비스가 없습니다."; Deleted = "폴더를 삭제했습니다: {0}"; Failed = "제거 실패: {0}"; PressEnter = "Enter 키를 누르면 닫힙니다" }
    en = @{ Removed = "The service was removed."; NotInstalled = "The service is not installed."; Deleted = "Deleted folder: {0}"; Failed = "Uninstall failed: {0}"; PressEnter = "Press Enter to close" }
}
$lang = (Get-UICulture).TwoLetterISOLanguageName
$m = if ($messages.ContainsKey($lang)) { $messages[$lang] } else { $messages.en }

$serviceName = 'PcMonitorService'
$target = Join-Path $env:ProgramFiles 'Ptty PC Monitor'

try {
    $existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($existing) {
        if ($existing.Status -ne 'Stopped') { Stop-Service -Name $serviceName -Force }
        sc.exe delete $serviceName | Out-Null
        Start-Sleep -Seconds 2
        Write-Host $m.Removed
    }
    else {
        Write-Host $m.NotInstalled
    }

    # 이름 변경 전 버전의 설치 폴더(C:\Program Files\PC Monitor)도 함께 정리합니다.
    foreach ($folder in $target, (Join-Path $env:ProgramFiles 'PC Monitor')) {
        if (Test-Path $folder) {
            Remove-Item $folder -Recurse -Force
            Write-Host ($m.Deleted -f $folder)
        }
    }
}
catch {
    Write-Host ($m.Failed -f $_) -ForegroundColor Red
}

Write-Host ""
Read-Host $m.PressEnter
