# Vectair Flite development launcher
# Starts the local HTTP server and Tauri desktop app for development.
# Optional git pull prompt included.

$repo = "C:\Users\dmshs\FDMS"

Set-Location $repo
git pull

Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$repo'; python -m http.server 8000 --directory src"
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$repo'; cargo tauri dev"
