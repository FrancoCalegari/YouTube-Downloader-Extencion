@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ==============================================================================
echo   YouTube Downloader & Converter - Instalador de Servicio para Windows
echo   Puerto configurado: 23458
echo ==============================================================================
echo.

set SCRIPT_DIR=%~dp0
cd /d "%SCRIPT_DIR%"

echo [INFO] Directorio de instalacion: %SCRIPT_DIR%
echo.

:: -----------------------------------------------------------------------------
:: 1. Verificar dependencias iniciales
:: -----------------------------------------------------------------------------
echo [1/5] Verificando dependencias iniciales...

:: Node.js
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js no esta instalado o no se encuentra en el PATH.
    echo.
    echo Puedes instalarlo rapidamente ejecutando en PowerShell:
    echo   winget install OpenJS.NodeJS
    echo O descargarlo desde: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo  [OK] Node.js detectado: %NODE_VER%

:: npm
where npm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] npm no esta disponible.
    pause
    exit /b 1
)

:: yt-dlp
where yt-dlp >nul 2>&1
if %ERRORLEVEL% neq 0 (
    if not exist "%SCRIPT_DIR%yt-dlp.exe" (
        echo [INFO] yt-dlp no detectado. Descargando binario oficial para Windows...
        curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe -o "%SCRIPT_DIR%yt-dlp.exe"
        if exist "%SCRIPT_DIR%yt-dlp.exe" (
            echo  [OK] yt-dlp.exe descargado exitosamente en la carpeta del proyecto.
        ) else (
            echo  [WARN] No se pudo descargar yt-dlp automaticamente. Instala con: winget install yt-dlp
        )
    ) else (
        echo  [OK] yt-dlp.exe local encontrado.
    )
) else (
    echo  [OK] yt-dlp detectado en el PATH del sistema.
)

:: ffmpeg
where ffmpeg >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo  [ADVERTENCIA] FFmpeg no fue detectado en el PATH.
    echo               Para conversion a MP3 y resoluciones altas se recomienda instalarlo con:
    echo               winget install Gyan.FFmpeg
    echo               O descargarlo de: https://www.gyan.dev/ffmpeg/builds/
    echo.
) else (
    echo  [OK] FFmpeg detectado.
)

:: -----------------------------------------------------------------------------
:: 2. Configurar archivo .env
:: -----------------------------------------------------------------------------
echo.
echo [2/5] Configurando variables de entorno (.env)...
if not exist ".env" (
    if exist ".env.example" (
        copy ".env.example" ".env" >nul
        echo  [OK] Archivo .env creado a partir de .env.example
    ) else (
        echo PORT=23458 > .env
        echo DEBUG=true >> .env
        echo YTDLP_PLAYER_CLIENTS=android,ios,web >> .env
    )
)

:: -----------------------------------------------------------------------------
:: 3. Instalar dependencias npm
:: -----------------------------------------------------------------------------
echo.
echo [3/5] Instalando paquetes de Node.js (npm install)...
call npm install --silent
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Fallo al instalar dependencias con npm.
    pause
    exit /b 1
)
echo  [OK] Dependencias instaladas correctamente.

if not exist "downloads" mkdir downloads

:: -----------------------------------------------------------------------------
:: 4. Configurar inicio automatico con Windows (Startup)
:: -----------------------------------------------------------------------------
echo.
echo [4/5] Configurando inicio automatico con la computadora...

set STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set SHORTCUT_VBS=%TEMP%\CreateShortcut_%RANDOM%.vbs

:: Crear acceso directo en la carpeta de inicio de Windows
echo Set oWS = WScript.CreateObject("WScript.Shell") > "%SHORTCUT_VBS%"
echo sLinkFile = "%STARTUP_FOLDER%\YouTubeDownloaderBackend.lnk" >> "%SHORTCUT_VBS%"
echo Set oLink = oWS.CreateShortcut(sLinkFile) >> "%SHORTCUT_VBS%"
echo oLink.TargetPath = "wscript.exe" >> "%SHORTCUT_VBS%"
echo oLink.Arguments = """" ^& "%SCRIPT_DIR%start_background.vbs" ^& """" >> "%SHORTCUT_VBS%"
echo oLink.WorkingDirectory = "%SCRIPT_DIR%" >> "%SHORTCUT_VBS%"
echo oLink.Description = "YouTube Downloader Backend Service" >> "%SHORTCUT_VBS%"
echo oLink.Save >> "%SHORTCUT_VBS%"

cscript //nologo "%SHORTCUT_VBS%"
del "%SHORTCUT_VBS%" >nul 2>&1

echo  [OK] Acceso directo de inicio automatico creado en:
echo       %STARTUP_FOLDER%\YouTubeDownloaderBackend.lnk

:: Tambien registrar tarea programada en Windows por seguridad
schtasks /query /tn "YouTubeDownloaderBackend" >nul 2>&1
if %ERRORLEVEL% equ 0 (
    schtasks /delete /tn "YouTubeDownloaderBackend" /f >nul 2>&1
)
schtasks /create /tn "YouTubeDownloaderBackend" /tr "wscript.exe \"%SCRIPT_DIR%start_background.vbs\"" /sc onlogon /f >nul 2>&1
echo  [OK] Tarea programada registrada en Windows (OnLogon).

:: -----------------------------------------------------------------------------
:: 5. Iniciar servicio en segundo plano ahora
:: -----------------------------------------------------------------------------
echo.
echo [5/5] Iniciando servidor en segundo plano...

:: Detener instancias previas en el puerto 23458 si las hubiera
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :23458 ^| findstr LISTENING') do (
    taskkill /F /PID %%a >nul 2>&1
)

:: Lanzar silenciosamente
wscript.exe "%SCRIPT_DIR%start_background.vbs"

echo Esperando que el servidor responda...
timeout /t 3 /nobreak >nul

curl -s http://localhost:23458/api/health >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo.
    echo ==============================================================================
    echo   [EXITO] El backend esta corriendo como servicio en segundo plano!
    echo ==============================================================================
    echo.
    echo   * URL del servidor:  http://localhost:23458
    echo   * Carpeta descargas: %SCRIPT_DIR%downloads
    echo   * Inicio automatico: Configurado para iniciar siempre con Windows
    echo.
    echo   Comandos utiles:
    echo     - Detener servidor:  Haz doble clic en stop_backend.bat
    echo     - Iniciar servidor:  Haz doble clic en start_background.vbs
    echo     - Desinstalar auto:  Haz doble clic en uninstall.bat
    echo.
) else (
    echo.
    echo [INFO] El iniciador fue ejecutado. Puedes verificar el estado en:
    echo        http://localhost:23458/api/health
    echo.
)

pause
