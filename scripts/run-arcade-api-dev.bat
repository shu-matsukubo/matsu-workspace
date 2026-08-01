@echo off

call "%~dp0modules\ensure-docker.bat"
if %errorlevel% neq 0 exit /b %errorlevel%

echo Starting matsu Arcade API and its PostgreSQL database in Docker dev mode...
cd /d "%~dp0..\apps\matsu-arcade-api"
docker compose up --build arcade-api
if errorlevel 1 (
    echo ERROR: matsu Arcade API dev service failed.
    exit /b 1
)
