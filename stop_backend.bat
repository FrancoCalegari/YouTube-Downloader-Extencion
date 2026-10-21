@echo off
chcp 65001 >nul
echo ======================================================
echo  YouTube Downloader - Detener Servidor Backend
echo ======================================================
echo.
echo Buscando procesos activos en el puerto 23458...

set FOUND=0
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :23458 ^| findstr LISTENING') do (
    set FOUND=1
    echo Deteniendo proceso backend (PID: %%a)...
    taskkill /F /PID %%a >nul 2>&1
)

if "%FOUND%"=="1" (
    echo [OK] El servidor backend se ha detenido correctamente.
) else (
    echo [INFO] No habia ningun servidor ejecutandose en el puerto 23458.
)

echo.
pause
