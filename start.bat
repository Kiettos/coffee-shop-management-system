@echo off
chcp 65001 >nul
cd /d "%~dp0backend"
where node >nul 2>nul
if errorlevel 1 (
  echo Chua cai Node.js. Hay tai ban LTS tai https://nodejs.org roi chay lai.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Dang cai thu vien lan dau...
  call npm install
)
start "" http://localhost:3000
node src/server.js
pause
