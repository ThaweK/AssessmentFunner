@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM AssessmentFunner - Windows launcher
REM Starts the app on localhost so microphone recording works in modern browsers.

cd /d "%~dp0"

set "HOST=localhost"
set "PORT=8000"
set "SERVER_MODE="
set "PY_CMD="

call :find_free_port
call :detect_python

if defined PY_CMD (
    set "SERVER_MODE=python"
) else (
    set "SERVER_MODE=powershell"
)

echo Starting AssessmentFunner on http://%HOST%:%PORT%
echo Press Ctrl+C to stop the server.
echo.

start "" "http://%HOST%:%PORT%/"

if /i "%SERVER_MODE%"=="python" (
    call %PY_CMD% -m http.server %PORT%
    goto :eof
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ErrorActionPreference = 'Stop';" ^
    "$port = %PORT%;" ^
    "$root = (Get-Location).Path;" ^
    "$listener = [System.Net.HttpListener]::new();" ^
    "$listener.Prefixes.Add(('http://localhost:{0}/' -f $port));" ^
    "$listener.Start();" ^
    "$mimeTypes = @{" ^
    "  '.html'='text/html; charset=utf-8'; '.css'='text/css; charset=utf-8'; '.js'='application/javascript; charset=utf-8';" ^
    "  '.json'='application/json; charset=utf-8'; '.txt'='text/plain; charset=utf-8'; '.png'='image/png'; '.jpg'='image/jpeg';" ^
    "  '.jpeg'='image/jpeg'; '.gif'='image/gif'; '.svg'='image/svg+xml'; '.ico'='image/x-icon'; '.webp'='image/webp';" ^
    "  '.mp3'='audio/mpeg'; '.wav'='audio/wav'; '.ogg'='audio/ogg'; '.webm'='audio/webm'; '.m4a'='audio/mp4';" ^
    "  '.woff'='font/woff'; '.woff2'='font/woff2'; '.ttf'='font/ttf'; '.otf'='font/otf';" ^
    "};" ^
    "Write-Host ('Server running on http://localhost:{0}' -f $port);" ^
    "try {" ^
    "  while ($listener.IsListening) {" ^
    "    $ctx = $listener.GetContext();" ^
    "    try {" ^
    "      $requestPath = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath);" ^
    "      if ([string]::IsNullOrWhiteSpace($requestPath) -or $requestPath -eq '/') { $requestPath = '/index.html' }" ^
    "      $relativePath = $requestPath.TrimStart('/').Replace('/', '\');" ^
    "      $fullPath = Join-Path $root $relativePath;" ^
    "      $fullPath = [System.IO.Path]::GetFullPath($fullPath);" ^
    "      if (-not $fullPath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {" ^
    "        $ctx.Response.StatusCode = 403;" ^
    "        $bytes = [System.Text.Encoding]::UTF8.GetBytes('Forbidden');" ^
    "      } elseif (Test-Path $fullPath -PathType Leaf) {" ^
    "        $ext = [System.IO.Path]::GetExtension($fullPath).ToLowerInvariant();" ^
    "        $ctx.Response.ContentType = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { 'application/octet-stream' };" ^
    "        $bytes = [System.IO.File]::ReadAllBytes($fullPath);" ^
    "        $ctx.Response.StatusCode = 200;" ^
    "      } else {" ^
    "        $ctx.Response.StatusCode = 404;" ^
    "        $bytes = [System.Text.Encoding]::UTF8.GetBytes('Not Found');" ^
    "      }" ^
    "      $ctx.Response.ContentLength64 = $bytes.Length;" ^
    "      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length);" ^
    "    } catch {" ^
    "      $ctx.Response.StatusCode = 500;" ^
    "      $bytes = [System.Text.Encoding]::UTF8.GetBytes('Internal Server Error');" ^
    "      $ctx.Response.ContentLength64 = $bytes.Length;" ^
    "      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length);" ^
    "    } finally {" ^
    "      $ctx.Response.OutputStream.Close();" ^
    "      $ctx.Response.Close();" ^
    "    }" ^
    "  }" ^
    "} finally {" ^
    "  $listener.Stop();" ^
    "  $listener.Close();" ^
    "}"

goto :eof

:detect_python
where py >nul 2>&1
if not errorlevel 1 (
    py -3 -c "import sys" >nul 2>&1
    if not errorlevel 1 (
        set "PY_CMD=py -3"
        goto :eof
    )
)

where python >nul 2>&1
if not errorlevel 1 (
    python -c "import sys" >nul 2>&1
    if not errorlevel 1 (
        set "PY_CMD=python"
        goto :eof
    )
)

where python3 >nul 2>&1
if not errorlevel 1 (
    python3 -c "import sys" >nul 2>&1
    if not errorlevel 1 (
        set "PY_CMD=python3"
        goto :eof
    )
)

goto :eof

:find_free_port
set /a PORT=%PORT%-1

:next_port
set /a PORT+=1
powershell -NoProfile -Command ^
    "$tcp = New-Object System.Net.Sockets.TcpClient;" ^
    "try { $tcp.Connect('%HOST%', %PORT%); exit 0 } catch { exit 1 } finally { $tcp.Dispose() }" >nul 2>&1
if not errorlevel 1 goto :next_port
goto :eof
