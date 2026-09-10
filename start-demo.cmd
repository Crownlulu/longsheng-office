@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 24, then run this file again.
  pause
  exit /b 1
)
call npm ci --no-audit --no-fund
if errorlevel 1 goto failed
call npm run build
if errorlevel 1 goto failed
set OFFICE_MODEL_MODE=rules
set OFFICE_DATA_PATH=.office-data/revision-demo.sqlite
echo Open http://127.0.0.1:5194/office after the server starts.
call npm run office
exit /b
:failed
echo Setup failed. Review the error above.
pause
exit /b 1
