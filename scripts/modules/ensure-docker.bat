@echo off

set DOCKER_EXE="C:\Program Files\Docker\Docker\resources\bin\docker.exe"

echo Starting Docker Desktop...
start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"

echo Waiting for WSL backend to start...
:wait_wsl
wsl -l -v >nul 2>&1
if %errorlevel% neq 0 (
    echo WSL not ready...
    timeout /t 2 >nul
    goto wait_wsl
)

echo WSL ready!

echo Waiting for Docker Engine...
:wait_docker
%DOCKER_EXE% info >nul 2>&1
if %errorlevel% neq 0 (
    echo Docker engine still starting...
    timeout /t 2 >nul
    goto wait_docker
)

echo Docker is ready!
