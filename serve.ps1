# Tiny static file server so the dashboard runs over http://localhost instead of file://.
# Needed because browsers send "Origin: null" for file:// pages, and Google Sheets' CSV
# export endpoint (and most CORS-protected APIs) reject that origin even when the sheet
# is public. Serving over localhost gives the page a real origin instead.
#
# It also provides /api/news, which the News page uses: browsers can't read Google News or Bing News
# results directly (cross-origin), so this server fetches them and hands the results back as JSON. Requests are handled on a small pool of threads so several can run at once.
#
# Usage: double-click start-dashboard.bat, or run:  powershell -ExecutionPolicy Bypass -File serve.ps1

param(
    [int]$Port = 8080,
    [switch]$NoBrowser
)

$root = $PSScriptRoot

$mimeTypes = @{
    ".html" = "text/html"
    ".htm"  = "text/html"
    ".js"   = "application/javascript"
    ".css"  = "text/css"
    ".csv"  = "text/csv"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".jpeg" = "image/jpeg"
    ".svg"  = "image/svg+xml"
    ".json" = "application/json"
    ".gif"  = "image/gif"
}

# Everything one request needs lives in this script block so it can run on a pool thread.
$handler = {
    param($context, $root, $mimeTypes)

    $UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

    function Get-Web($url) {
        Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 20 -Headers @{ "User-Agent" = $UA; "Accept-Language" = "en-US,en;q=0.9" }
    }

    function ConvertTo-IsoDate($text) {
        try { return ([DateTimeOffset]::Parse($text, [Globalization.CultureInfo]::InvariantCulture)).UtcDateTime.ToString("o") } catch { return $null }
    }

    function Get-Text($node) {
        if ($null -eq $node) { return "" }
        if ($node -is [System.Xml.XmlElement]) { return [string]$node.InnerText }
        return [string]$node
    }

    function Get-Snippet($html) {
        $t = [Net.WebUtility]::HtmlDecode(([regex]::Replace([string]$html, "<[^>]+>", " ")))
        $t = [regex]::Replace($t, "\s+", " ").Trim()
        if ($t.Length -gt 260) { $t = $t.Substring(0, 257) + "..." }
        return $t
    }

    # News articles: Bing News (cleaner relevance) + Google News (broader), merged and de-duplicated.
    function Get-NewsArticles($q) {
        $enc = [uri]::EscapeDataString($q)
        $items = New-Object System.Collections.ArrayList
        try {
            [xml]$x = (Get-Web "https://www.bing.com/news/search?q=$enc&format=rss").Content
            foreach ($it in @($x.rss.channel.item)) {
                $link = [string]$it.link
                $m = [regex]::Match($link, "[?&]url=([^&]+)")
                if ($m.Success) { $link = [uri]::UnescapeDataString($m.Groups[1].Value) }
                [void]$items.Add(@{
                    title = [Net.WebUtility]::HtmlDecode([string]$it.title); url = $link; source = (Get-Text $it.Source)
                    date = (ConvertTo-IsoDate ([string]$it.pubDate)); snippet = (Get-Snippet $it.description); image = (Get-Text $it.Image); kind = "article"
                })
            }
        } catch { }
        try {
            [xml]$x = (Get-Web "https://news.google.com/rss/search?q=$enc&hl=en-US&gl=US&ceid=US:en").Content
            foreach ($it in @($x.rss.channel.item)) {
                $src = Get-Text $it.source
                if ($src -match "Baseball Savant") { continue } # hundreds of per-pitch clip pages — noise
                $title = [Net.WebUtility]::HtmlDecode([string]$it.title)
                if ($src -and $title.EndsWith(" - $src")) { $title = $title.Substring(0, $title.Length - $src.Length - 3) }
                [void]$items.Add(@{ title = $title; url = [string]$it.link; source = $src; date = (ConvertTo-IsoDate ([string]$it.pubDate)); snippet = ""; image = ""; kind = "article" })
            }
        } catch { }
        $seen = @{}
        $out = New-Object System.Collections.ArrayList
        foreach ($i in ($items | Sort-Object { $_.date } -Descending)) {
            $key = ([regex]::Replace($i.title.ToLower(), "[^a-z0-9]", ""))
            if (-not $key -or $seen.ContainsKey($key)) { continue }
            $seen[$key] = 1
            [void]$out.Add($i)
            if ($out.Count -ge 30) { break }
        }
        return $out
    }

    $request = $context.Request
    $response = $context.Response
    try {
        $localPath = $request.Url.LocalPath

        # Turn a snapshot of the team report (posted as HTML) into a PDF using a hidden Chrome/Edge, save it under
        # Documents\DST Team Reports, and (optionally) reveal it in File Explorer so it can be attached to an email.
        if ($localPath -eq "/api/report-pdf" -and $request.HttpMethod -eq "POST") {
            $payload = $null
            $tmpHtml = $null
            $tmpProfile = $null
            try {
                $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
                $body = $reader.ReadToEnd()
                $reader.Close()
                if (-not $body) { throw "empty report" }

                $name = $request.QueryString["name"]
                $safe = ([regex]::Replace([string]$name, '[\\/:*?"<>|]', "-")).Trim()
                if (-not $safe) { $safe = "Team Report" }
                $dir = Join-Path ([Environment]::GetFolderPath("MyDocuments")) "DST Team Reports"
                New-Item -ItemType Directory -Force -Path $dir | Out-Null
                $out = Join-Path $dir "$safe.pdf"
                if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }

                $exe = @(
                    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
                    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
                    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
                    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
                    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
                ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
                if (-not $exe) { throw "Couldn't find Chrome or Edge to build the PDF." }

                $id = [guid]::NewGuid().ToString("N")
                $tmpHtml = Join-Path $env:TEMP "dst-report-$id.html"
                $tmpProfile = Join-Path $env:TEMP "dst-pdf-profile-$id"
                [System.IO.File]::WriteAllText($tmpHtml, $body, (New-Object System.Text.UTF8Encoding($false)))

                $chromeArgs = @(
                    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
                    "--user-data-dir=`"$tmpProfile`"", "--no-pdf-header-footer", "--virtual-time-budget=12000",
                    "--print-to-pdf=`"$out`"", "`"file:///$($tmpHtml -replace '\\', '/')`""
                )
                $proc = Start-Process -FilePath $exe -ArgumentList $chromeArgs -PassThru -WindowStyle Hidden
                if (-not $proc.WaitForExit(90000)) { try { $proc.Kill() } catch { } }

                # give a just-exited browser a moment to finish flushing the file
                for ($i = 0; $i -lt 20 -and -not (Test-Path -LiteralPath $out); $i++) { Start-Sleep -Milliseconds 250 }
                if (-not (Test-Path -LiteralPath $out) -or (Get-Item -LiteralPath $out).Length -lt 1000) { throw "The PDF wasn't created." }

                if ($request.QueryString["reveal"] -ne "0") {
                    Start-Process -FilePath "explorer.exe" -ArgumentList "/select,`"$out`""
                }
                $payload = ConvertTo-Json -Compress -InputObject @{ ok = $true; path = $out }
            } catch {
                $payload = ConvertTo-Json -Compress -InputObject @{ ok = $false; error = $_.Exception.Message }
            } finally {
                if ($tmpHtml) { Remove-Item -LiteralPath $tmpHtml -Force -ErrorAction SilentlyContinue }
                if ($tmpProfile) { Remove-Item -LiteralPath $tmpProfile -Recurse -Force -ErrorAction SilentlyContinue }
            }
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
            $response.ContentType = "application/json; charset=utf-8"
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
            return
        }

        if ($localPath -eq "/api/news") {
            $q = $request.QueryString["q"]
            $payload = $null
            try {
                if (-not $q) { throw "missing q" }
                $items = Get-NewsArticles $q
                $payload = ConvertTo-Json -Depth 6 -Compress -InputObject @{ items = @($items) }
            } catch {
                $payload = ConvertTo-Json -Compress -InputObject @{ items = @(); error = $_.Exception.Message }
            }
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
            $response.ContentType = "application/json; charset=utf-8"
            $response.Headers.Add("Cache-Control", "no-store")
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
            return
        }

        if ($localPath -eq "/") { $localPath = "/index.html" }
        $relative = $localPath.TrimStart("/") -replace "/", [System.IO.Path]::DirectorySeparatorChar
        $filePath = [System.IO.Path]::GetFullPath((Join-Path $root $relative))

        if (-not $filePath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
            $response.StatusCode = 403
        } elseif (Test-Path -LiteralPath $filePath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($filePath).ToLowerInvariant()
            $contentType = $mimeTypes[$ext]
            if (-not $contentType) { $contentType = "application/octet-stream" }
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $response.ContentType = $contentType
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $response.StatusCode = 404
            $notFound = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $localPath")
            $response.OutputStream.Write($notFound, 0, $notFound.Length)
        }
    } catch {
        try { $response.StatusCode = 500 } catch { }
    } finally {
        try { $response.OutputStream.Close() } catch { }
    }
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")

try {
    $listener.Start()
} catch {
    Write-Host "Could not start on port $Port - it is already in use." -ForegroundColor Red
    Write-Host "The dashboard server is probably already running (possibly in a window you can't see)." -ForegroundColor Yellow
    Write-Host "Try opening http://localhost:$Port/index.html in your browser. If the page is out of date," -ForegroundColor Yellow
    Write-Host "end the old 'powershell' process for serve.ps1 in Task Manager, then run this again." -ForegroundColor Yellow
    Write-Host "Or use another port:  powershell -ExecutionPolicy Bypass -File serve.ps1 -Port 8081" -ForegroundColor Yellow
    exit 1
}

Write-Host "Serving $root"
Write-Host "Dashboard running at http://localhost:$Port/index.html"
Write-Host "Press Ctrl+C in this window to stop the server."

if (-not $NoBrowser) { Start-Process "http://localhost:$Port/index.html" }

# Handle each request on a pool thread so slow news lookups never block page loads.
$pool = [runspacefactory]::CreateRunspacePool(1, 8)
$pool.Open()
$running = New-Object System.Collections.ArrayList

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
    } catch {
        break
    }
    for ($i = $running.Count - 1; $i -ge 0; $i--) {
        if ($running[$i].Handle.IsCompleted) {
            try { $running[$i].Shell.EndInvoke($running[$i].Handle) } catch { }
            $running[$i].Shell.Dispose()
            $running.RemoveAt($i)
        }
    }
    $ps = [powershell]::Create()
    $ps.RunspacePool = $pool
    [void]$ps.AddScript($handler).AddArgument($context).AddArgument($root).AddArgument($mimeTypes)
    [void]$running.Add(@{ Shell = $ps; Handle = $ps.BeginInvoke() })
}
