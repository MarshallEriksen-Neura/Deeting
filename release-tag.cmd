@echo off
setlocal EnableExtensions EnableDelayedExpansion

if /i "%~1"=="--help" goto :help
if /i "%~1"=="-h" goto :help
if "%~1"=="/?" goto :help

set "REMOTE=origin"
if not "%~1"=="" set "REMOTE=%~1"

if not exist "deeting\package.json" (
  echo [release-tag] deeting\package.json not found. Run this script from the repo root.
  exit /b 1
)

set "VERSION_LINE="
for /f "usebackq delims=" %%L in (`findstr /r /c:"^[ ]*\"version\": \"" "deeting\package.json"`) do (
  set "VERSION_LINE=%%L"
  goto :version_found
)

echo [release-tag] Failed to read version from deeting\package.json.
exit /b 1

:version_found
set "VERSION=!VERSION_LINE:*\"version\": \"=!"
for /f "delims=\" %%V in ("!VERSION!") do set "VERSION=%%V"

if not defined VERSION (
  echo [release-tag] Parsed version is empty.
  exit /b 1
)

set "TAG=v!VERSION!"

echo [release-tag] Version: !VERSION!
echo [release-tag] Tag: !TAG!

git rev-parse --verify "!TAG!" >nul 2>nul
if not errorlevel 1 (
  echo [release-tag] Local tag !TAG! already exists.
  exit /b 1
)

git ls-remote --exit-code --tags "%REMOTE%" "refs/tags/!TAG!" >nul 2>nul
if not errorlevel 1 (
  echo [release-tag] Remote tag !TAG! already exists on %REMOTE%.
  exit /b 1
)

set "DIRTY="
for /f "usebackq delims=" %%S in (`git status --short`) do (
  set "DIRTY=1"
  goto :status_checked
)

:status_checked
if defined DIRTY (
  echo [release-tag] Warning: working tree has local changes. The tag will point to current HEAD only.
)

echo [release-tag] Creating annotated tag !TAG!...
git tag -a "!TAG!" -m "Release !TAG!"
if errorlevel 1 exit /b 1

echo [release-tag] Pushing !TAG! to %REMOTE%...
git push "%REMOTE%" "!TAG!"
if errorlevel 1 exit /b 1

echo [release-tag] Done.
exit /b 0

:help
echo Usage: release-tag.cmd [remote]
echo.
echo Reads the version from deeting\package.json, creates tag v^<version^>,
echo and pushes it to the selected remote.
echo.
echo Examples:
echo   release-tag.cmd
echo   release-tag.cmd origin
exit /b 0
