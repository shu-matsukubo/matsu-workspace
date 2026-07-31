@echo off

call "%~dp0modules\ensure-docker.bat"
if %errorlevel% neq 0 exit /b %errorlevel%

echo Starting matsu API...
cd /d "%~dp0..\apps\matsu-api"
docker compose up -d
if errorlevel 1 (
    echo ERROR: matsu API failed to start.
    exit /b 1
)

echo Starting matsu Auth...
cd /d "%~dp0..\apps\matsu-auth"
docker compose up -d
if errorlevel 1 (
    echo ERROR: matsu Auth failed to start.
    exit /b 1
)

echo Starting matsu Toolbox API...
cd /d "%~dp0..\apps\matsu-toolbox-api"
docker compose up -d --build
if errorlevel 1 (
    echo ERROR: matsu Toolbox API failed to start.
    exit /b 1
)

echo Starting matsu Arcade Auth...
cd /d "%~dp0..\apps\matsu-arcade-auth"
docker compose up -d --build
if errorlevel 1 (
    echo ERROR: matsu Arcade Auth failed to start.
    exit /b 1
)

echo Starting matsu Arcade API dev in a new window...
start "matsu-arcade-api-dev" "%~dp0run-arcade-api-dev.bat"
if errorlevel 1 (
    echo ERROR: matsu Arcade API launcher failed to open.
    exit /b 1
)

echo Starting matsu BFF dev in a new window...
start "matsu-bff-dev" "%~dp0run-bff-dev.bat"
if errorlevel 1 (
    echo ERROR: matsu BFF launcher failed to open.
    exit /b 1
)

echo Starting matsu Front dev in a new window...
start "matsu-front-dev" "%~dp0run-front-dev.bat"
if errorlevel 1 (
    echo ERROR: matsu Front launcher failed to open.
    exit /b 1
)

echo matsu API/Auth, Toolbox API, and Arcade Auth are detached.
echo Arcade API, BFF, and Front dev logs are in separate windows.
