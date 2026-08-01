@echo off

call "%~dp0modules\ensure-docker.bat"
if %errorlevel% neq 0 exit /b %errorlevel%

echo Starting matsu API...
cd /d "%~dp0..\apps\matsu-api"
docker compose up -d api
if errorlevel 1 (
    echo ERROR: matsu API failed to start.
    exit /b 1
)

echo Starting matsu Auth...
cd /d "%~dp0..\apps\matsu-auth"
docker compose up -d auth
if errorlevel 1 (
    echo ERROR: matsu Auth failed to start.
    exit /b 1
)

echo Starting matsu Arcade Auth...
cd /d "%~dp0..\apps\matsu-arcade-auth"
docker compose up -d --build arcade-auth
if errorlevel 1 (
    echo ERROR: matsu Arcade Auth failed to start.
    exit /b 1
)

echo Starting matsu Toolbox API in detached Docker dev mode...
cd /d "%~dp0..\apps\matsu-toolbox-api"
docker compose up -d --build toolbox-api
if errorlevel 1 (
    echo ERROR: matsu Toolbox API dev service failed to start.
    exit /b 1
)

echo Starting matsu Arcade API in detached Docker dev mode...
cd /d "%~dp0..\apps\matsu-arcade-api"
docker compose up -d --build arcade-api
if errorlevel 1 (
    echo ERROR: matsu Arcade API dev service failed to start.
    exit /b 1
)

echo Starting matsu BFF in detached Docker dev mode...
cd /d "%~dp0..\apps\matsu-bff"
docker compose up -d bff
if errorlevel 1 (
    echo ERROR: matsu BFF dev service failed to start.
    exit /b 1
)

echo Starting matsu Front in detached Docker dev mode...
cd /d "%~dp0..\apps\matsu-front"
docker compose up -d front
if errorlevel 1 (
    echo ERROR: matsu Front dev service failed to start.
    exit /b 1
)

echo All matsu application services are running in detached mode.
echo Front, BFF, Toolbox API, and Arcade API keep hot reload enabled.
echo Use docker logs -f ^<container-name^> to follow an individual service.
