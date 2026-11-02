# OPL-Datenspiegel auf einem Windows-Server einrichten.
# Ausführen in einer PowerShell als Administrator, im Ordner mit opl_spiegel.py:
#   powershell -ExecutionPolicy Bypass -File .\einrichten.ps1
#
# Was passiert:
#   1. Python wird gesucht (py -3 oder python).
#   2. Der Lese-Token wird verdeckt abgefragt und in token.txt gespeichert;
#      die Datei dürfen nur das ausführende Konto und Administratoren lesen.
#   3. Ein erster Lauf holt alle Daten (opl_spiegel.sqlite entsteht).
#   4. Eine geplante Aufgabe "OPL-Datenspiegel" holt ab dann stündlich die Änderungen.

param(
  [int]$IntervallMinuten = 60,
  [string]$Aufgabe = 'OPL-Datenspiegel'
)
$ErrorActionPreference = 'Stop'
$ordner = Split-Path -Parent $MyInvocation.MyCommand.Path
$skript = Join-Path $ordner 'opl_spiegel.py'
if (-not (Test-Path $skript)) { throw "opl_spiegel.py nicht gefunden in $ordner" }

# 1. Python finden
$python = $null
foreach ($kandidat in @('py', 'python')) {
  $cmd = Get-Command $kandidat -ErrorAction SilentlyContinue
  if ($cmd) { $python = $cmd.Source; break }
}
if (-not $python) { throw 'Python 3 nicht gefunden. Bitte von python.org installieren (Option "Add python.exe to PATH").' }
# "py" ist der Python-Launcher und braucht "-3", "python.exe" nicht
$pyArgList = @()
if ((Split-Path -Leaf $python) -ieq 'py.exe') { $pyArgList = @('-3') }
Write-Host "Python: $python"

# Konto, unter dem die Aufgabe läuft (muss Internet/Proxy-Zugang haben)
$cred = Get-Credential -Message 'Konto für die geplante Aufgabe (z. B. DOMAIN\dienstkonto)' -UserName "$env:USERDOMAIN\$env:USERNAME"

# 2. Token verdeckt abfragen und geschützt ablegen
$tokenDatei = Join-Path $ordner 'token.txt'
if (-not (Test-Path $tokenDatei)) {
  $sicher = Read-Host 'Lese-Token (READ_TOKEN aus Cloudflare) eingeben' -AsSecureString
  $klar = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sicher))
  Set-Content -Path $tokenDatei -Value $klar -NoNewline -Encoding UTF8
  $klar = $null
  icacls $tokenDatei /inheritance:r /grant:r "$($cred.UserName):R" "*S-1-5-32-544:F" | Out-Null
  Write-Host 'token.txt angelegt (nur Aufgabenkonto und Administratoren dürfen lesen).'
}

# 3. Erster Lauf (volle Liste)
& $python @pyArgList $skript --voll
if ($LASTEXITCODE -ne 0) { throw 'Erster Lauf fehlgeschlagen – siehe Meldung oben.' }

# 4. Geplante Aufgabe
$argumente = (($pyArgList + @("`"$skript`"")) -join ' ')
$aktion = New-ScheduledTaskAction -Execute $python -Argument $argumente -WorkingDirectory $ordner
$ausloeser = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Minutes $IntervallMinuten)
$einstellungen = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $Aufgabe -Action $aktion -Trigger $ausloeser -Settings $einstellungen `
  -User $cred.UserName -Password $cred.GetNetworkCredential().Password -RunLevel Limited -Force | Out-Null
Write-Host "Geplante Aufgabe '$Aufgabe' eingerichtet: alle $IntervallMinuten Minuten. Datenbank: $(Join-Path $ordner 'opl_spiegel.sqlite')"
