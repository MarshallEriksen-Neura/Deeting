$ErrorActionPreference = "Stop"

$absentPaths = @(
  @{
    Name = "deeting_core directory must be removed"
    Path = "deeting_core"
  },
  @{
    Name = "desktop browser auth API module must be removed"
    Path = "deeting/lib/api/auth-desktop-browser.ts"
  }
)

$checks = @(
  @{
    Name = "chat layout must not require auth guard"
    Path = "deeting/app/[locale]/chat/layout.tsx"
    Pattern = "ChatAuthGuard"
  },
  @{
    Name = "locale layout must not mount auth world bridge"
    Path = "deeting/app/[locale]/layout.tsx"
    Pattern = "AuthWorldBridge"
  },
  @{
    Name = "desktop http client must not default to deeting_core"
    Path = "deeting/lib/http/client.ts"
    Pattern = "localhost:8000|NEXT_PUBLIC_API_BASE_URL"
  },
  @{
    Name = "desktop config must not trigger cloud platform model sync"
    Path = "deeting/lib/api/desktop-config.ts"
    Pattern = "sync_platform_models"
  },
  @{
    Name = "tauri utils must not include desktop browser auth cloud diagnostic"
    Path = "deeting/src-tauri/src/utils.rs"
    Pattern = "api/v1/auth/desktop/browser|NEXT_PUBLIC_API_BASE_URL|api.ethereals.space"
  },
  @{
    Name = "desktop capabilities must not verify admin role through cloud user api"
    Path = "deeting/src-tauri/src/modules/desktop_runtime/desktop_capabilities.rs"
    Pattern = "api/v1/users/me|desktop_current_user_info"
  },
  @{
    Name = "settings desktop branches must not require login"
    Path = "deeting/app/[locale]/settings/components/settings-form.tsx"
    Pattern = "canEditDesktop = isAuthenticated|canSave = isAuthenticated;|!isAuthenticated \|\| !isTauriRuntime|if \(!isAuthenticated\)"
  },
  @{
    Name = "chat model config guard must not wait for auth"
    Path = "deeting/components/chat/routing/chat-model-config-guard.tsx"
    Pattern = "useAuthStore|isAuthenticated"
  },
  @{
    Name = "desktop header auth control must short-circuit local runtime"
    Path = "deeting/components/layout/header/header-auth-control.tsx"
    RequiredPattern = "if \(isDesktopRuntime\(\)\)"
  },
  @{
    Name = "release workflow must not require cloud desktop auth env"
    Path = ".github/workflows/release.yml"
    Pattern = "NEXT_PUBLIC_API_BASE_URL|NEXT_PUBLIC_DESKTOP_EXTERNAL_LOGIN_URL"
  },
  @{
    Name = "desktop auth UI must not reference external login env or browser sessions"
    Path = "deeting/components/auth/login-form.tsx"
    Pattern = "NEXT_PUBLIC_DESKTOP_EXTERNAL_LOGIN_URL|desktop_login_session|diagnose_auth_desktop_browser_start_request"
  },
  @{
    Name = "auth world model must not launch desktop browser login"
    Path = "deeting/hooks/use-auth-world-model.ts"
    Pattern = "NEXT_PUBLIC_DESKTOP_EXTERNAL_LOGIN_URL|startDesktopBrowserLogin|desktop_browser"
  }
)

$failed = $false

foreach ($pathCheck in $absentPaths) {
  if (Test-Path -LiteralPath $pathCheck.Path) {
    Write-Host "[FAIL] $($pathCheck.Name): still exists at $($pathCheck.Path)"
    $failed = $true
  } else {
    Write-Host "[PASS] $($pathCheck.Name)"
  }
}

foreach ($check in $checks) {
  if (-not (Test-Path -LiteralPath $check.Path)) {
    Write-Host "[FAIL] $($check.Name): missing $($check.Path)"
    $failed = $true
    continue
  }

  if ($check.ContainsKey("Pattern")) {
    $matches = Select-String -LiteralPath $check.Path -Pattern $check.Pattern -AllMatches
    if ($matches) {
      Write-Host "[FAIL] $($check.Name)"
      foreach ($match in $matches) {
        Write-Host "  $($match.Path):$($match.LineNumber): $($match.Line.Trim())"
      }
      $failed = $true
    } else {
      Write-Host "[PASS] $($check.Name)"
    }
  }

  if ($check.ContainsKey("RequiredPattern")) {
    $matches = Select-String -LiteralPath $check.Path -Pattern $check.RequiredPattern -AllMatches
    if (-not $matches) {
      Write-Host "[FAIL] $($check.Name): missing required pattern $($check.RequiredPattern)"
      $failed = $true
    } else {
      Write-Host "[PASS] $($check.Name)"
    }
  }
}

if ($failed) {
  exit 1
}

Write-Host "[PASS] desktop local-only cloud dependency guard"
