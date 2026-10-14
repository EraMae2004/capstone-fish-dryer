# Presentation boot: Laravel on all interfaces + publish current LAN IP to Firebase.
# Phone and ESP32 read lan/server — no hardcoded IPv4 edits when campus Wi-Fi changes.
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

Write-Host "Starting Laravel on 0.0.0.0:8000 ..."
Start-Process powershell -WorkingDirectory $here -ArgumentList @(
  "-NoExit",
  "-Command",
  "php artisan serve --host=0.0.0.0 --port=8000"
)

Start-Sleep -Seconds 2

Write-Host "Publishing LAN address to Firebase (watch mode) ..."
Start-Process powershell -WorkingDirectory $here -ArgumentList @(
  "-NoExit",
  "-Command",
  "php artisan firebase:publish-lan --watch"
)

Write-Host ""
Write-Host "Connect this PC to the phone hotspot first. Leave both windows open."
Write-Host "Open Expo Go on that phone. Do not type an address."
