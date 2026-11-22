@echo off
rem HYDRA launcher - no install, no admin rights, no internet.
rem Starts a small server for this folder on http://localhost:17171 (real project folder in Documents\HYDRA,
rem autosave and backups, install-as-app) and opens HYDRA. If that is not possible it opens HYDRA.html directly.
setlocal
cd /d "%~dp0"
where powershell >nul 2>&1 || goto fallback
if not exist "%~dp0launcher\hydra-server.ps1" goto fallback
title HYDRA server
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher\hydra-server.ps1" %*
if errorlevel 1 goto fallback
exit /b 0
:fallback
start "" "%~dp0HYDRA.html"
exit /b 0
