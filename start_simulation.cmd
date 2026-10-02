@echo off
setlocal
cd /d "%~dp0"
call tools\run_python.cmd tools\serve_web.py --simulate --open
if errorlevel 1 pause
