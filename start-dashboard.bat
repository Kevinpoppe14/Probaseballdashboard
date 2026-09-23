@echo off
title Dashboard server (keep this window open while you use the dashboard)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
echo.
echo The dashboard server stopped. If you did not expect that, read the message above.
pause
