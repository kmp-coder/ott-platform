@echo off
title RangManch OTT Server
cd /d "%~dp0"
if not exist node_modules (
  echo First-time setup: installing dependencies, please wait...
  call npm install --no-audit --no-fund
)
start "" http://localhost:4000
echo RangManch OTT is starting... your browser will open at http://localhost:4000
echo Keep this window open while using the platform. Close it to stop the server.
node server.js
pause
