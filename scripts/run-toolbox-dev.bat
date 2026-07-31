@echo off

call "%~dp0modules\ensure-docker.bat"
if %errorlevel% neq 0 exit /b %errorlevel%

echo Starting matsu Toolbox API and its PostgreSQL database...
cd /d "%~dp0..\apps\matsu-toolbox-api"
docker compose up -d --build
if errorlevel 1 (
    echo ERROR: matsu Toolbox API failed to start.
    exit /b 1
)

echo matsu Toolbox API is running in detached mode.
