@echo off
setlocal
cd /d "%~dp0"
call tools\run_python.cmd tools\serve_web.py --open
if errorlevel 1 pause
