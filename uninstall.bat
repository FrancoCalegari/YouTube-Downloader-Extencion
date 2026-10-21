@echo off
chcp 65001 >nul
echo ==============================================================================
echo   YouTube Downloader - Desinstalador de Servicio para Windows
echo ==============================================================================
echo.

set SCRIPT_DIR=%~dp0
set STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set SHORTCUT_FILE=%STARTUP_FOLDER%\YouTubeDownloaderBackend.lnk

echo [1/3] Deteniendo procesos en ejecucion en el puerto 23458...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :23458 ^| findstr LISTENING') do (
    echo Deteniendo proceso backend (PID: %%a)...
    taskkill /F /PID %%a >nul 2>&1
)

echo [2/3] Eliminando tarea programada de Windows...
schtasks /delete /tn "YouTubeDownloaderBackend" /f >nul 2>&1

echo [3/3] Eliminando acceso directo de inicio automatico...
if exist "%SHORTCUT_FILE%" (
    del /f /q "%SHORTCUT_FILE%" >nul 2>&1
    echo [OK] Acceso directo eliminado de la carpeta de inicio.
)

echo.
echo ==============================================================================
echo   [OK] El inicio automatico y el servicio han sido desinstalados.
echo ==============================================================================
echo.
pause
