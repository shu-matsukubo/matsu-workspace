@echo off

call "%~dp0modules\ensure-docker.bat"
if %errorlevel% neq 0 exit /b %errorlevel%

echo Starting matsu Toolbox API and its PostgreSQL database in Docker dev mode...
cd /d "%~dp0..\apps\matsu-toolbox-api"
docker compose up --build toolbox-api
if errorlevel 1 (
    echo ERROR: matsu Toolbox API dev service failed.
    exit /b 1
)
