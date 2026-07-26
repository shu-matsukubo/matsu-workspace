@echo off
setlocal EnableExtensions

set "GIT_ROOT=C:\Program Files\Git"
set "GIT_BASH=%GIT_ROOT%\bin\bash.exe"
if not exist "%GIT_BASH%" (
    echo ERROR: Git Bash was not found:
    echo   %GIT_BASH%
    echo Install Git for Windows or run scripts\sync-dev.sh from another shell.
    pause
    exit /b 1
)

"%GIT_BASH%" --login "%~dp0sync-dev.sh"
set "RESULT=%ERRORLEVEL%"

echo.
if "%RESULT%"=="0" (
    echo Development modules are ready.
) else (
    echo Module synchronization failed. Review the error above.
)
pause
exit /b %RESULT%
