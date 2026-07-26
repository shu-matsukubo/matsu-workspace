@echo off

call "%~dp0modules\ensure-docker.bat"
if %errorlevel% neq 0 exit /b %errorlevel%

echo Starting matsu API...
cd /d "%~dp0..\apps\matsu-api"
docker compose up -d
if %errorlevel% neq 0 exit /b %errorlevel%

echo Starting matsu Auth...
cd /d "%~dp0..\apps\matsu-auth"
docker compose up -d
if %errorlevel% neq 0 exit /b %errorlevel%

echo Starting matsu BFF dev in a new window...
start "matsu-bff-dev" "%~dp0run-bff-dev.bat"

echo Starting matsu Front dev in a new window...
start "matsu-front-dev" "%~dp0run-front-dev.bat"

echo matsu API/Auth are detached. BFF/Front dev logs are in separate windows.
