@echo off
chcp 65001 >nul
title PZ Version and Mod Freezer
powershell.exe -NoLogo -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0PZ-Freezer.ps1" %*
if errorlevel 1 (
  echo.
  echo PZ Freezer failed to start. Check the logs directory.
  pause
)
