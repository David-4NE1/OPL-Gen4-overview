# OPL 4NE1 Gen4 - Testbetrieb auf einem Windows-Server
#
# Startet die OPL mit den Daten aus diesem Datenpaket lokal (Cloudflares
# Entwicklungsserver "wrangler dev"). Nur zum Ausprobieren, kein Dauerbetrieb.
#
# Aufruf im entpackten Datenpaket (normale PowerShell, keine Admin-Rechte nötig):
#   powershell -ExecutionPolicy Bypass -File .\testbetrieb.ps1
#
# Optionen:
#   -Port 8787         anderer Port
#   -NeuEinspielen     Daten aus dem Paket erneut einspielen (Änderungen im Test gehen verloren)
#   -CodeAktualisieren neuesten Programmstand von GitHub holen (Daten bleiben)
#
# Was passiert (alles im Unterordner "testbetrieb", nichts wird installiert):
#   1. Node.js wird als portable ZIP von nodejs.org geladen
#   2. Der Programmcode der OPL wird von GitHub geladen (öffentliches Repository)
#   3. Wrangler (Cloudflares Entwicklungsserver) wird per npm geladen
#   4. Ein Test-Passwort wird abgefragt; die Daten werden eingespielt
#   5. Die OPL startet unter http://localhost:<Port>
# Benötigter Internetzugang: nodejs.org, github.com/codeload.github.com, registry.npmjs.org

param(
  [int]$Port = 8787,
  [switch]$NeuEinspielen,
  [switch]$CodeAktualisieren
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$WRANGLER_VERSION = '4.151.3'
$REPO_ZIP = 'https://codeload.github.com/David-4NE1/OPL-Gen4-overview/zip/refs/heads/main'

$paket = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not (Test-Path (Join-Path $paket 'manifest.json'))) { throw "Kein Datenpaket: manifest.json fehlt in $paket" }
$basis = Join-Path $paket 'testbetrieb'
$nodeDir = Join-Path $basis 'node'
$app = Join-Path $basis 'opl'
New-Item -ItemType Directory -Force $basis | Out-Null

function Schritt($text) { Write-Host ''; Write-Host "== $text" -ForegroundColor Cyan }

# Firmen-Proxy aus den Windows-Einstellungen übernehmen (auch für npm/Node)
$sysProxy = [System.Net.WebRequest]::GetSystemWebProxy()
$sysProxy.Credentials = [System.Net.CredentialCache]::DefaultNetworkCredentials
[System.Net.WebRequest]::DefaultWebProxy = $sysProxy
$ziel = [Uri]'https://registry.npmjs.org/'
$proxyUri = $sysProxy.GetProxy($ziel)
if ($proxyUri -and $proxyUri.AbsoluteUri -ne $ziel.AbsoluteUri) {
  $env:HTTPS_PROXY = $proxyUri.AbsoluteUri
  $env:HTTP_PROXY = $proxyUri.AbsoluteUri
  Write-Host "Proxy: $($proxyUri.Authority)"
}

function Laden($url, $datei) {
  Invoke-WebRequest -Uri $url -OutFile $datei -UseBasicParsing
}

function Entpacken($zip, $nach) {
  if (Test-Path $nach) { Remove-Item -Recurse -Force $nach }
  Expand-Archive -Path $zip -DestinationPath $nach -Force
  Remove-Item -Force $zip
  # ZIPs enthalten einen Oberordner (node-v.../OPL-Gen4-overview-main)
  return (Get-ChildItem -Directory $nach | Select-Object -First 1).FullName
}

# 1. Node.js (portable)
$nodeExe = Join-Path $nodeDir 'node.exe'
if (-not (Test-Path $nodeExe)) {
  Schritt 'Node.js laden (portable, wird nicht installiert)'
  $index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing
  $version = ($index | Where-Object {
      $_.lts -and @('22', '24') -contains $_.version.TrimStart('v').Split('.')[0] -and $_.files -contains 'win-x64-zip'
    } | Select-Object -First 1).version
  if (-not $version) { throw 'Keine passende Node.js-Version gefunden.' }
  Write-Host "Node.js $version"
  $zip = Join-Path $basis 'node.zip'
  Laden "https://nodejs.org/dist/$version/node-$version-win-x64.zip" $zip
  $ordner = Entpacken $zip (Join-Path $basis 'node-tmp')
  Move-Item $ordner $nodeDir
  Remove-Item -Recurse -Force (Join-Path $basis 'node-tmp')
}
$env:Path = "$nodeDir;$env:Path"
$npm = Join-Path $nodeDir 'npm.cmd'

# 2. Programmcode
if (-not (Test-Path (Join-Path $app 'wrangler.toml')) -or $CodeAktualisieren) {
  Schritt 'Programmcode der OPL von GitHub laden'
  $zip = Join-Path $basis 'opl.zip'
  Laden $REPO_ZIP $zip
  $ordner = Entpacken $zip (Join-Path $basis 'opl-tmp')
  if (Test-Path $app) {
    # Daten, Pakete und Passwort behalten, Code ersetzen
    foreach ($behalten in @('.wrangler', 'node_modules', '.dev.vars', 'package.json', 'package-lock.json')) {
      $quelle = Join-Path $app $behalten
      if (Test-Path $quelle) { Move-Item $quelle (Join-Path $ordner $behalten) -Force }
    }
    Remove-Item -Recurse -Force $app
  }
  Move-Item $ordner $app
  Remove-Item -Recurse -Force (Join-Path $basis 'opl-tmp')
  # Ohne Cloudflare-Konto gibt es keine maschinelle Übersetzung: AI-Bindung entfernen
  $toml = Join-Path $app 'wrangler.toml'
  $inhalt = (Get-Content -Raw -Encoding UTF8 $toml) -replace '(?ms)^\[ai\]\s*\r?\nbinding\s*=\s*"AI"\s*', ''
  [IO.File]::WriteAllText($toml, $inhalt, (New-Object Text.UTF8Encoding $false))
}

# 3. Wrangler
$wrangler = Join-Path $app 'node_modules\.bin\wrangler.cmd'
if (-not (Test-Path $wrangler)) {
  Schritt "Wrangler $WRANGLER_VERSION laden (npm)"
  Push-Location $app
  try {
    if (-not (Test-Path 'package.json')) { [IO.File]::WriteAllText((Join-Path $app 'package.json'), '{ "private": true }') }
    & $npm install --no-audit --no-fund --save-exact "wrangler@$WRANGLER_VERSION"
    if ($LASTEXITCODE -ne 0) { throw 'npm install fehlgeschlagen (Proxy/Internetzugang prüfen).' }
  } finally { Pop-Location }
}
$env:WRANGLER_SEND_METRICS = 'false'

# 4. Test-Passwort
$devVars = Join-Path $app '.dev.vars'
if (-not (Test-Path $devVars)) {
  Schritt 'Test-Passwort festlegen'
  Write-Host 'Mit diesem Passwort melden sich alle freigeschalteten Adressen im Testbetrieb an.'
  Write-Host 'Bitte NICHT das Passwort der echten OPL verwenden.'
  $sicher = Read-Host 'Test-Passwort' -AsSecureString
  $klar = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sicher))
  if (-not $klar) { throw 'Kein Passwort eingegeben.' }
  [IO.File]::WriteAllText($devVars, "OPL_PASSWORD=$klar`nHTTP_TESTBETRIEB=1`n", (New-Object Text.UTF8Encoding $false))
  $klar = $null
}

# 5. Daten einspielen (erster Start oder -NeuEinspielen)
$merker = Join-Path $basis 'eingespielt.txt'
if (-not (Test-Path $merker) -or $NeuEinspielen) {
  Schritt 'Daten aus dem Paket einspielen'
  Push-Location $app
  try {
    # legt die lokale Datenbank an, falls es sie noch nicht gibt
    & $wrangler d1 execute opl-gen4 --local --yes --command 'SELECT 1' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Lokale Datenbank konnte nicht angelegt werden.' }
  } finally { Pop-Location }
  $dbDatei = Get-ChildItem (Join-Path $app '.wrangler\state\v3\d1\miniflare-D1DatabaseObject\*.sqlite') |
    Where-Object { $_.Name -ne 'metadata.sqlite' } | Select-Object -First 1
  if (-not $dbDatei) { throw 'Lokale Datenbankdatei nicht gefunden.' }
  & $nodeExe --no-warnings (Join-Path $paket 'opl_umzug_einspielen.mjs') $paket $dbDatei.FullName
  if ($LASTEXITCODE -ne 0) { Write-Warning 'Beim Einspielen gab es Abweichungen - siehe oben.' }
  Set-Content -Path $merker -Value (Get-Date -Format s)
}

# 6. Starten
Schritt 'OPL starten'
Write-Host "Auf diesem Server:    http://localhost:$Port"
Write-Host "Von anderen Rechnern: http://$($env:COMPUTERNAME):$Port  (Windows-Firewall muss Port $Port erlauben)"
Write-Host 'Anmelden mit einer freigeschalteten E-Mail-Adresse und dem Test-Passwort. Beenden mit Strg+C.'
Push-Location $app
try {
  & $wrangler dev --local --ip 0.0.0.0 --port $Port
} finally { Pop-Location }
