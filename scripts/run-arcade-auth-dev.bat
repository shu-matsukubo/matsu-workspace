@echo off

call "%~dp0modules\ensure-docker.bat"
if %errorlevel% neq 0 exit /b %errorlevel%

echo Starting matsu Arcade Auth and its PostgreSQL database...
cd /d "%~dp0..\apps\matsu-arcade-auth"
docker compose up -d --build
if errorlevel 1 (
    echo ERROR: matsu Arcade Auth failed to start.
    exit /b 1
)

echo matsu Arcade Auth is running in detached mode.
