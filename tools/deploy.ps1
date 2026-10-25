# Publishes the app: stamps a new version (so open apps know to refresh), then deploys to Firebase Hosting.
# Run from the project folder:  powershell -ExecutionPolicy Bypass -File tools\deploy.ps1
$ErrorActionPreference = 'Stop'
$version = Get-Date -Format 'yyyy.MM.dd-HHmm'
$utf8 = New-Object Text.UTF8Encoding $false
[IO.File]::WriteAllText((Resolve-Path 'version.json'), "{ `"version`": `"$version`" }`n", $utf8)
$v = Get-Content 'js\version.js' -Raw
[IO.File]::WriteAllText((Resolve-Path 'js\version.js'), ($v -replace "APP_VERSION = '[^']*'", "APP_VERSION = '$version'"), $utf8)
$sw = Get-Content 'sw.js' -Raw
[IO.File]::WriteAllText((Resolve-Path 'sw.js'), ($sw -replace "meal-planner-v[^']*'", "meal-planner-v$version'"), $utf8)
Write-Output "Version $version"
& .\node_modules\.bin\firebase.cmd deploy --only hosting --project meal-planner-pwg
