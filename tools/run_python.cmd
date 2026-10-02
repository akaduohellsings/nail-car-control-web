@echo off
where py >nul 2>&1
if not errorlevel 1 (
  py -3 %*
  exit /b
)
where python >nul 2>&1
if not errorlevel 1 (
  python %*
  exit /b
)
if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" (
  "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" %*
  exit /b
)
echo Python 3 was not found.
exit /b 1
