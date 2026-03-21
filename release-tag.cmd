@echo off
setlocal EnableExtensions EnableDelayedExpansion

if /i "%~1"=="--help" goto :help
if /i "%~1"=="-h" goto :help
if "%~1"=="/?" goto :help

set "REMOTE=origin"
set "ALLOW_DIRTY="

:parse_args
if "%~1"=="" goto :args_done
if /i "%~1"=="--allow-dirty" (
  set "ALLOW_DIRTY=1"
  shift
  goto :parse_args
)
if /i "%~1"=="--help" goto :help
if /i "%~1"=="-h" goto :help
if "%~1"=="/?" goto :help
set "REMOTE=%~1"
shift
goto :parse_args

:args_done
call :require_file "deeting\package.json" || exit /b 1
call :require_file "deeting\src-tauri\tauri.conf.json" || exit /b 1
call :require_file "deeting\src-tauri\Cargo.toml" || exit /b 1
call :require_file "installer\package.json" || exit /b 1
call :require_file "installer\src-tauri\tauri.conf.json" || exit /b 1
call :require_file "installer\src-tauri\Cargo.toml" || exit /b 1

call :read_json_version "deeting\package.json" APP_PACKAGE_VERSION || exit /b 1
call :read_json_version "deeting\src-tauri\tauri.conf.json" APP_TAURI_VERSION || exit /b 1
call :read_toml_version "deeting\src-tauri\Cargo.toml" APP_CARGO_VERSION || exit /b 1
call :read_json_version "installer\package.json" INSTALLER_PACKAGE_VERSION || exit /b 1
call :read_json_version "installer\src-tauri\tauri.conf.json" INSTALLER_TAURI_VERSION || exit /b 1
call :read_toml_version "installer\src-tauri\Cargo.toml" INSTALLER_CARGO_VERSION || exit /b 1

set "VERSION=%APP_PACKAGE_VERSION%"

call :ensure_match "deeting\src-tauri\tauri.conf.json" "%APP_TAURI_VERSION%" "%VERSION%" || exit /b 1
call :ensure_match "deeting\src-tauri\Cargo.toml" "%APP_CARGO_VERSION%" "%VERSION%" || exit /b 1
call :ensure_match "installer\package.json" "%INSTALLER_PACKAGE_VERSION%" "%VERSION%" || exit /b 1
call :ensure_match "installer\src-tauri\tauri.conf.json" "%INSTALLER_TAURI_VERSION%" "%VERSION%" || exit /b 1
call :ensure_match "installer\src-tauri\Cargo.toml" "%INSTALLER_CARGO_VERSION%" "%VERSION%" || exit /b 1

if not defined VERSION (
  echo [release-tag] Parsed version is empty.
  exit /b 1
)

set "TAG=v%VERSION%"

echo [release-tag] Version: %VERSION%
echo [release-tag] Tag: %TAG%
echo [release-tag] Remote: %REMOTE%

set "DIRTY="
for /f "delims=" %%S in ('git status --short') do (
  set "DIRTY=1"
  goto :dirty_checked
)

:dirty_checked
if defined DIRTY (
  if defined ALLOW_DIRTY (
    echo [release-tag] Warning: working tree has local changes. Continuing because --allow-dirty was provided.
  ) else (
    echo [release-tag] Working tree has local changes. Commit or stash before tagging.
    exit /b 1
  )
)

git rev-parse --verify "%TAG%" >nul 2>nul
if not errorlevel 1 (
  echo [release-tag] Local tag %TAG% already exists.
  exit /b 1
)

git ls-remote --exit-code --tags "%REMOTE%" "refs/tags/%TAG%" >nul 2>nul
if not errorlevel 1 (
  echo [release-tag] Remote tag %TAG% already exists on %REMOTE%.
  exit /b 1
)

echo [release-tag] Creating annotated tag %TAG%...
git tag -a "%TAG%" -m "Release %TAG%"
if errorlevel 1 exit /b 1

echo [release-tag] Pushing %TAG% to %REMOTE%...
git push "%REMOTE%" "%TAG%"
if errorlevel 1 exit /b 1

echo [release-tag] Done.
exit /b 0

:require_file
if exist "%~1" exit /b 0
echo [release-tag] File not found: %~1
exit /b 1

:read_json_version
set "%~2="
set "LINE="
for /f "usebackq delims=" %%L in (`findstr /r /c:"^[ ]*\"version\": \"" "%~1"`) do (
  if not defined LINE set "LINE=%%L"
)
if not defined LINE (
  echo [release-tag] Failed to read version from %~1
  exit /b 1
)
set "VALUE=!LINE:*\"version\": \"=!"
for /f "delims=\" %%V in ("!VALUE!") do set "%~2=%%V"
if not defined %~2 (
  echo [release-tag] Parsed version is empty for %~1
  exit /b 1
)
exit /b 0

:read_toml_version
set "%~2="
set "LINE="
for /f "usebackq delims=" %%L in (`findstr /r /c:"^version *= *\"" "%~1"`) do (
  if not defined LINE set "LINE=%%L"
)
if not defined LINE (
  echo [release-tag] Failed to read version from %~1
  exit /b 1
)
set "VALUE=!LINE:*version = \"=!"
for /f "delims=\" %%V in ("!VALUE!") do set "%~2=%%V"
if not defined %~2 (
  echo [release-tag] Parsed version is empty for %~1
  exit /b 1
)
exit /b 0

:ensure_match
if /i "%~2"=="%~3" exit /b 0
echo [release-tag] Version mismatch: %~1 has %~2 but expected %~3
exit /b 1

:help
echo Usage: release-tag.cmd [remote] [--allow-dirty]
echo.
echo Validates that app and installer versions match, creates tag v^<version^>,
echo and pushes it to the selected remote.
echo.
echo Examples:
echo   release-tag.cmd
echo   release-tag.cmd origin
echo   release-tag.cmd origin --allow-dirty
exit /b 0
