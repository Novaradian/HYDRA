# HYDRA launcher: a tiny localhost web server for the HYDRA folder (no install, no admin rights, no internet).
# Started by HYDRA.bat. It serves this folder at http://localhost:17171 and gives the app a real project folder
# (Documents\HYDRA: projects, autosave, backups) and the samples folder. Only this computer can reach it, and only
# the HYDRA page itself (it holds the key) may use the file functions. Close this window to stop HYDRA's server.
param([int]$Port = 17171, [switch]$NoBrowser, [string]$DataDir = '', [int]$IdleExit = 90)
$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
if (-not $DataDir) { $DataDir = if ($env:HYDRA_HOME) { $env:HYDRA_HOME } else { Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'HYDRA' } }
$DataDir = [IO.Path]::GetFullPath($DataDir)
$Areas = [ordered]@{ projects = (Join-Path $DataDir 'projects'); autosave = (Join-Path $DataDir 'autosave'); backups = (Join-Path $DataDir 'backups'); samples = (Join-Path $Root 'samples') }
foreach ($a in 'projects', 'autosave', 'backups') { New-Item -ItemType Directory -Force -Path $Areas[$a] | Out-Null }
$Writable = @('projects', 'autosave')
$KeepBackups = 10

# the key: kept in the data folder so an installed HYDRA app (PWA) keeps working across launches
$keyFile = Join-Path $DataDir 'launcher.key'
if (Test-Path -LiteralPath $keyFile) { $Key = (Get-Content -LiteralPath $keyFile -Raw).Trim() }
if (-not $Key -or $Key.Length -lt 32) { $Key = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N'); Set-Content -LiteralPath $keyFile -Value $Key -Encoding ASCII }

$Mime = @{ '.html' = 'text/html; charset=utf-8'; '.js' = 'application/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json; charset=utf-8'
  '.webmanifest' = 'application/manifest+json'; '.png' = 'image/png'; '.svg' = 'image/svg+xml'; '.gif' = 'image/gif'; '.ico' = 'image/x-icon'; '.cur' = 'image/x-icon'
  '.ogg' = 'audio/ogg'; '.wav' = 'audio/wav'; '.mp3' = 'audio/mpeg'; '.txt' = 'text/plain; charset=utf-8'; '.md' = 'text/plain; charset=utf-8'; '.hydra' = 'application/zip'; '.woff2' = 'font/woff2' }

function Open-App([string]$url) {
  if ($NoBrowser) { return }
  $cands = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe")
  $b = $cands | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
  if ($b) { Start-Process -FilePath $b -ArgumentList "--app=$url" } else { Start-Process $url }
}
function Send($ctx, [int]$code, [byte[]]$bytes, [string]$type) {
  $r = $ctx.Response; $r.StatusCode = $code; if ($type) { $r.ContentType = $type }
  $r.Headers['Cache-Control'] = 'no-cache'; $r.Headers['X-Content-Type-Options'] = 'nosniff'
  if ($null -eq $bytes) { $bytes = [byte[]]@() }
  $r.ContentLength64 = $bytes.Length; if ($bytes.Length) { $r.OutputStream.Write($bytes, 0, $bytes.Length) }; $r.OutputStream.Close()
}
function SendJson($ctx, $obj, [int]$code = 200) { Send $ctx $code ([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $obj -Depth 6 -Compress))) 'application/json; charset=utf-8' }
function Fail($ctx, [int]$code, [string]$msg) { SendJson $ctx @{ ok = $false; error = $msg } $code }
function Body($req) { $ms = New-Object IO.MemoryStream; $req.InputStream.CopyTo($ms); return , $ms.ToArray() }
function SafeName([string]$n) { return $n -and $n.Length -le 140 -and $n -match '^[\w][\w\-\. ()+]*\.(hydra|json)$' -and $n -notmatch '\.\.' }
function Stamp() { (Get-Date).ToString('yyyyMMdd-HHmmss') }

function Handle-Api($ctx, [string]$path, [int]$port) {
  $req = $ctx.Request
  if ($path -eq '/api/hello') { SendJson $ctx @{ hydra = $true; root = $Root }; return }
  $origin = $req.Headers['Origin']
  if ($origin -and $origin -ne "http://localhost:$port" -and $origin -ne "http://127.0.0.1:$port") { Fail $ctx 403 'origin'; return }
  if ($req.Headers['X-HYDRA-Key'] -ne $Key) { Fail $ctx 403 'key'; return }
  $script:lastPing = Get-Date; $script:pinged = $true
  $area = $req.QueryString['area']; $name = $req.QueryString['name']
  switch ($path) {
    '/api/ping' { SendJson $ctx @{ ok = $true }; return }
    '/api/info' { SendJson $ctx @{ ok = $true; launcher = 1; port = $port; root = $Root; home = $DataDir; projects = $Areas.projects; autosave = $Areas.autosave; backups = $Areas.backups; samples = $Areas.samples; keep = $KeepBackups }; return }
    '/api/list' {
      if (-not $Areas.Contains([string]$area)) { Fail $ctx 400 'area'; return }
      $dir = $Areas[$area]; $out = @()
      if (Test-Path -LiteralPath $dir) { $out = @(Get-ChildItem -LiteralPath $dir -File | Where-Object { $_.Extension -in '.hydra', '.json' -and $_.Name -ne 'index.json' } | Sort-Object LastWriteTime -Descending | ForEach-Object { @{ name = $_.Name; size = $_.Length; mtime = $_.LastWriteTimeUtc.ToString('o') } }) }
      SendJson $ctx @{ ok = $true; area = $area; dir = $dir; files = $out }; return }
    '/api/file' {
      if (-not $Areas.Contains([string]$area) -or -not (SafeName $name)) { Fail $ctx 400 'name'; return }
      $file = Join-Path $Areas[$area] $name
      if ($req.HttpMethod -eq 'GET') { if (-not (Test-Path -LiteralPath $file)) { Fail $ctx 404 'missing'; return }; Send $ctx 200 ([IO.File]::ReadAllBytes($file)) 'application/octet-stream'; return }
      if ($Writable -notcontains $area) { Fail $ctx 403 'read-only area'; return }
      if ($req.HttpMethod -eq 'PUT') {
        if ($req.ContentLength64 -gt 512MB) { Fail $ctx 413 'too large'; return }
        $bytes = Body $req; $backup = $null
        if ($area -eq 'projects' -and (Test-Path -LiteralPath $file)) { # keep the previous version, newest $KeepBackups per project
          $base = [IO.Path]::GetFileNameWithoutExtension($name); $ext = [IO.Path]::GetExtension($name)
          $backup = "$($base)_$(Stamp)$ext"; Copy-Item -LiteralPath $file -Destination (Join-Path $Areas.backups $backup) -Force
          Get-ChildItem -LiteralPath $Areas.backups -File | Where-Object { $_.Name -like "$($base)_*$ext" -and $_.Name.Length -eq ($base.Length + 16 + $ext.Length) } | Sort-Object Name -Descending | Select-Object -Skip $KeepBackups | Remove-Item -Force }
        $tmp = "$file.part"; [IO.File]::WriteAllBytes($tmp, $bytes); if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }; Move-Item -LiteralPath $tmp -Destination $file
        SendJson $ctx @{ ok = $true; path = $file; size = $bytes.Length; backup = $backup }; return }
      if ($req.HttpMethod -eq 'DELETE') { if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }; SendJson $ctx @{ ok = $true }; return }
      Fail $ctx 405 'method'; return }
    '/api/reveal' { if (-not $Areas.Contains([string]$area)) { Fail $ctx 400 'area'; return }; Start-Process explorer.exe $Areas[$area]; SendJson $ctx @{ ok = $true }; return }
    '/api/quit' { SendJson $ctx @{ ok = $true }; $script:quit = $true; return }
  }
  Fail $ctx 404 'api'
}
function Handle-File($ctx) {
  $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
  if (-not $rel) { $ctx.Response.Redirect('/HYDRA.html'); $ctx.Response.Close(); return }
  try { $full = [IO.Path]::GetFullPath((Join-Path $Root $rel)) } catch { Fail $ctx 400 'path'; return }
  if (-not $full.StartsWith($Root.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) -or $full -like '*\launcher\*' -or -not (Test-Path -LiteralPath $full -PathType Leaf)) { Send $ctx 404 ([Text.Encoding]::UTF8.GetBytes('not found')) 'text/plain'; return }
  $ext = [IO.Path]::GetExtension($full).ToLowerInvariant(); $type = $Mime[$ext]; if (-not $type) { $type = 'application/octet-stream' }
  if ($ctx.Request.HttpMethod -eq 'HEAD') { Send $ctx 200 $null $type; return }
  Send $ctx 200 ([IO.File]::ReadAllBytes($full)) $type
}

# ---- reuse a HYDRA server that already runs for this folder; else take the first free port ----
$listener = $null; $usePort = 0
for ($p = $Port; $p -lt $Port + 10; $p++) {
  try { $hi = Invoke-RestMethod -Uri "http://localhost:$p/api/hello" -TimeoutSec 2 -UseBasicParsing; if ($hi.hydra -and $hi.root -eq $Root) { Write-Host "HYDRA already runs at http://localhost:$p"; Open-App "http://localhost:$p/HYDRA.html#k=$Key"; exit 0 } ; continue } catch { }
  try { $l = New-Object System.Net.HttpListener; $l.Prefixes.Add("http://localhost:$p/"); $l.Start(); $listener = $l; $usePort = $p; break } catch { }
}
if (-not $listener) { Write-Host 'HYDRA: no free port for the local server - opening HYDRA.html directly.'; exit 2 }
if ($usePort -ne $Port) { Write-Host "Note: port $Port is busy, using $usePort (projects are the same; browser storage of this port is separate)." }

$host.UI.RawUI.WindowTitle = "HYDRA server - localhost:$usePort"
Write-Host ''
Write-Host "  HYDRA is running at http://localhost:$usePort/HYDRA.html"
Write-Host "  Projects : $($Areas.projects)"
Write-Host "  Autosave : $($Areas.autosave)    Backups: $($Areas.backups)"
Write-Host '  Keep this window open while you work. It closes by itself shortly after the last HYDRA window.'
Write-Host ''
Open-App "http://localhost:$usePort/HYDRA.html#k=$Key"

$started = Get-Date; $script:lastPing = $started; $script:pinged = $false; $script:quit = $false
try {
  while ($listener.IsListening -and -not $script:quit) {
    $task = $listener.GetContextAsync()
    while (-not $task.AsyncWaitHandle.WaitOne(1000)) {
      $idle = ((Get-Date) - $script:lastPing).TotalSeconds
      if (($script:pinged -and $idle -gt $IdleExit) -or (-not $script:pinged -and $idle -gt 900)) { $script:quit = $true; break }
    }
    if ($script:quit) { break }
    $ctx = $task.GetAwaiter().GetResult()
    try {
      $path = $ctx.Request.Url.AbsolutePath
      if ($path.StartsWith('/api/')) { Handle-Api $ctx $path $usePort } else { Handle-File $ctx }
    } catch { try { Fail $ctx 500 ($_.Exception.Message) } catch { } }
  }
} finally { $listener.Stop(); $listener.Close() }
Write-Host 'HYDRA server stopped.'
exit 0
