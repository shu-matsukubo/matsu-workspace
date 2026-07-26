@echo off

call "%~dp0modules\ensure-docker.bat"
if %errorlevel% neq 0 exit /b %errorlevel%

echo Starting matsu BFF in Docker dev mode...
cd /d "%~dp0..\apps\matsu-bff"
docker compose up
