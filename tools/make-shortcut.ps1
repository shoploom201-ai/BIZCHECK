# 간편 근퇴관리 바탕 화면 바로가기 만들기
#  - 엣지 / 크롬 중 골라서 주소창 없는 앱 창으로 여는 바로가기를 만듭니다.
#  - 데이터는 브라우저마다 따로 저장되므로, 평소 쓰는 브라우저를 고르세요.
#  사용: '바로가기 만들기.bat' 더블클릭  (또는 -Browser edge|chrome|both)
param([string]$Browser = '')

$ErrorActionPreference = 'Stop'
$proj = Split-Path -Parent $PSScriptRoot
$app = Join-Path $proj 'app.html'
$ico = Join-Path $proj 'icon.ico'
$desk = [Environment]::GetFolderPath('Desktop')
$url = ([System.Uri]$app).AbsoluteUri

function Find-Exe($paths) {
  foreach ($p in $paths) { if ($p -and (Test-Path $p)) { return $p } }
  return $null
}
$edge = Find-Exe @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe")
$chrome = Find-Exe @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe")

if (-not $Browser) {
  Write-Host ''
  Write-Host '  간편 근퇴관리 바탕 화면 바로가기 만들기'
  Write-Host '  ※ 직원·출퇴근 데이터는 브라우저마다 따로 저장됩니다. 평소 쓰던 브라우저를 고르세요.'
  Write-Host ''
  Write-Host ('  1. 엣지' + $(if ($edge) { '' } else { '  (설치되어 있지 않음)' }))
  Write-Host ('  2. 크롬' + $(if ($chrome) { '' } else { '  (설치되어 있지 않음)' }))
  Write-Host '  3. 둘 다'
  Write-Host ''
  $c = Read-Host '  번호를 입력하고 Enter'
  $Browser = @{ '1' = 'edge'; '2' = 'chrome'; '3' = 'both' }[$c.Trim()]
  if (-not $Browser) { Write-Host '  잘못 입력했습니다.'; exit 1 }
}

$targets = @()
if ($Browser -in 'edge', 'both') { $targets += , @('엣지', $edge) }
if ($Browser -in 'chrome', 'both') { $targets += , @('크롬', $chrome) }

$ws = New-Object -ComObject WScript.Shell
foreach ($t in $targets) {
  $label, $exe = $t
  if (-not $exe) { Write-Host "  $label 이(가) 설치되어 있지 않아 건너뜁니다."; continue }
  $lnk = Join-Path $desk "간편 근퇴관리 ($label).lnk"
  $s = $ws.CreateShortcut($lnk)
  $s.TargetPath = $exe
  $s.Arguments = "--app=`"$url`""
  $s.WorkingDirectory = $proj
  if (Test-Path $ico) { $s.IconLocation = "$ico,0" }
  $s.Description = "간편 근퇴관리 ($label)"
  $s.Save()
  Write-Host "  만들었습니다: $lnk"
}

# 예전 방식(브라우저 이름 없는) 바로가기는 정리
$old = Join-Path $desk '간편 근퇴관리.lnk'
if (Test-Path $old) { Remove-Item $old; Write-Host '  예전 바로가기(간편 근퇴관리.lnk)를 지웠습니다.' }
