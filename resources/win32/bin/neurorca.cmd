@echo off
setlocal
set "ORCA_CLI_COMMAND=neurorca"
set "SCRIPT_DIR=%~dp0"
set "LAUNCHER=%SCRIPT_DIR%neurorca.exe"

if not exist "%LAUNCHER%" (
  echo Unable to locate the native Neurorca CLI launcher at "%LAUNCHER%" 1>&2
  exit /b 1
)

if /I "%~1"=="orchestration" if /I "%~2"=="send" goto :unsafe_body
if /I "%~1"=="orchestration" if /I "%~2"=="reply" goto :unsafe_body

"%LAUNCHER%" %*
exit /b %ERRORLEVEL%

:unsafe_body
echo neurorca.cmd cannot safely forward orchestration message bodies. Use "%LAUNCHER%" instead. 1>&2
exit /b 2
