$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$port = 8080
Start-Job -ScriptBlock { param($u) Start-Sleep -Milliseconds 800; Start-Process $u } -ArgumentList "http://127.0.0.1:$port/" | Out-Null
if (Get-Command py -ErrorAction SilentlyContinue) {
  py -3 -m http.server $port --bind 127.0.0.1
} else {
  python -m http.server $port --bind 127.0.0.1
}
