@echo off
REM AssessmentFunner — Windows launcher
REM Double-click this file to start the app

cd /d "%~dp0"
set PORT=8000

REM Check if Python is available
where python3 >nul 2>&1 && (set "PY=python3" & goto :found)
where python >nul 2>&1 && (set "PY=python" & goto :found)

REM Python not found — try to install it
echo Python not found. Attempting to install...
echo.

REM Try winget (Windows 10 1709+ / Windows 11)
where winget >nul 2>&1
if %errorlevel%==0 (
    echo Installing Python via winget...
    winget install Python.Python.3.12 --accept-package-agreements --accept-source-agreements
    if %errorlevel%==0 (
        echo.
        echo Python installed. Restarting launcher...
        echo.
        REM Refresh PATH for this session
        set "PATH=%LOCALAPPDATA%\Programs\Python\Python312;%LOCALAPPDATA%\Programs\Python\Python312\Scripts;%PATH%"
        set "PY=python"
        goto :found
    )
)

REM Winget failed or unavailable — fall back to PowerShell HTTP server
echo.
echo Could not install Python automatically.
echo Falling back to PowerShell HTTP server...
echo.
echo Starting AssessmentFunner on http://localhost:%PORT%
echo Press Ctrl+C to stop the server.
echo.

start "" "http://localhost:%PORT%"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$listener = [System.Net.HttpListener]::new();" ^
    "$listener.Prefixes.Add('http://localhost:%PORT%/');" ^
    "$listener.Start();" ^
    "Write-Host 'Server running on http://localhost:%PORT%';" ^
    "$root = (Get-Location).Path;" ^
    "$mimeTypes = @{" ^
    "  '.html'='text/html'; '.css'='text/css'; '.js'='application/javascript';" ^
    "  '.json'='application/json'; '.png'='image/png'; '.jpg'='image/jpeg';" ^
    "  '.jpeg'='image/jpeg'; '.gif'='image/gif'; '.svg'='image/svg+xml';" ^
    "  '.ico'='image/x-icon'; '.woff'='font/woff'; '.woff2'='font/woff2';" ^
    "};" ^
    "while ($listener.IsListening) {" ^
    "  $ctx = $listener.GetContext();" ^
    "  $path = $ctx.Request.Url.LocalPath;" ^
    "  if ($path -eq '/') { $path = '/index.html' }" ^
    "  $file = Join-Path $root ($path -replace '/','\');" ^
    "  if (Test-Path $file -PathType Leaf) {" ^
    "    $ext = [System.IO.Path]::GetExtension($file);" ^
    "    $ct = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { 'application/octet-stream' };" ^
    "    $bytes = [System.IO.File]::ReadAllBytes($file);" ^
    "    $ctx.Response.ContentType = $ct;" ^
    "    $ctx.Response.ContentLength64 = $bytes.Length;" ^
    "    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length);" ^
    "  } else {" ^
    "    $ctx.Response.StatusCode = 404;" ^
    "    $bytes = [System.Text.Encoding]::UTF8.GetBytes('Not Found');" ^
    "    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length);" ^
    "  }" ^
    "  $ctx.Response.Close();" ^
    "}"

goto :eof

:found
echo Starting AssessmentFunner on http://localhost:%PORT%
echo Press Ctrl+C to stop the server.
echo.

start "" "http://localhost:%PORT%"
%PY% -m http.server %PORT%
