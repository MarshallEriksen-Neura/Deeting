"use client";

import type { TerminalCommandSnapshot } from "./terminal-command-boundaries";

const POWERSHELL_OSC_133_INIT_SCRIPT = String.raw`
$global:__DEETING_OSC133_COMMAND_ACTIVE = $false
if (-not $global:__DEETING_OSC133_ORIGINAL_PROMPT) {
  $global:__DEETING_OSC133_ORIGINAL_PROMPT = (Get-Command prompt -CommandType Function).ScriptBlock
}
function global:__deeting_osc133_emit([string]$Payload) {
  [Console]::Write("$([char]27)]133;$Payload$([char]7)")
}
function global:prompt {
  $deetingSucceeded = $?
  $deetingNativeExitCode = $global:LASTEXITCODE
  $deetingExitCode = if ($deetingSucceeded) { 0 } elseif ($deetingNativeExitCode -is [int] -and $deetingNativeExitCode -ne 0) { $deetingNativeExitCode } else { 1 }
  if ($global:__DEETING_OSC133_COMMAND_ACTIVE) {
    __deeting_osc133_emit "D;$deetingExitCode"
    $global:__DEETING_OSC133_COMMAND_ACTIVE = $false
  }
  $deetingCwd = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Get-Location).Path))
  __deeting_osc133_emit "A;cwd_base64=$deetingCwd"
  & $global:__DEETING_OSC133_ORIGINAL_PROMPT
}
try {
  Import-Module PSReadLine -ErrorAction SilentlyContinue
  if (Get-Module PSReadLine) {
    Set-PSReadLineKeyHandler -Key Enter -BriefDescription DeetingOsc133AcceptLine -ScriptBlock {
      $line = ""
      $cursor = 0
      [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$line, [ref]$cursor)
      if ($line.Trim().Length -gt 0) {
        $global:__DEETING_OSC133_COMMAND_ACTIVE = $true
        $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($line))
        [Console]::Write("$([char]27)]133;C;command_base64=$encoded$([char]7)")
      }
      [Microsoft.PowerShell.PSConsoleReadLine]::AcceptLine()
    }
  }
} catch {}
`;

const SHELL_DOLLAR = "$";

const POSIX_OSC_133_INIT_SCRIPT = String.raw`
__deeting_osc133_emit() { printf '\033]133;%s\a' "$1"; }
__deeting_osc133_encode() { printf '%s' "$1" | base64 | tr -d '\n'; }
__deeting_osc133_pwd_payload() { printf 'cwd_base64=%s' "$(__deeting_osc133_encode "$PWD")"; }
if [ -n "${SHELL_DOLLAR}{ZSH_VERSION:-}" ]; then
  __deeting_osc133_preexec() {
    __DEETING_OSC133_COMMAND_ACTIVE=1
    __deeting_osc133_emit "C;command_base64=$(__deeting_osc133_encode "$1")"
  }
  __deeting_osc133_precmd() {
    local status=$?
    if [ "${SHELL_DOLLAR}{__DEETING_OSC133_COMMAND_ACTIVE:-0}" = "1" ]; then
      __deeting_osc133_emit "D;$status"
      __DEETING_OSC133_COMMAND_ACTIVE=0
    fi
    __deeting_osc133_emit "A;$(__deeting_osc133_pwd_payload)"
  }
  autoload -Uz add-zsh-hook 2>/dev/null
  if command -v add-zsh-hook >/dev/null 2>&1; then
    add-zsh-hook preexec __deeting_osc133_preexec
    add-zsh-hook precmd __deeting_osc133_precmd
  else
    preexec_functions+=(__deeting_osc133_preexec)
    precmd_functions+=(__deeting_osc133_precmd)
  fi
elif [ -n "${SHELL_DOLLAR}{BASH_VERSION:-}" ]; then
  __DEETING_OSC133_PROMPT_READY=1
  __deeting_osc133_debug() {
    if [ "${SHELL_DOLLAR}{__DEETING_OSC133_PROMPT_READY:-0}" != "1" ]; then return; fi
    __DEETING_OSC133_PROMPT_READY=0
    __DEETING_OSC133_COMMAND_ACTIVE=1
    __deeting_osc133_emit "C;command_base64=$(__deeting_osc133_encode "$BASH_COMMAND")"
  }
  __deeting_osc133_prompt() {
    local status=$?
    __DEETING_OSC133_PROMPT_READY=0
    if [ "${SHELL_DOLLAR}{__DEETING_OSC133_COMMAND_ACTIVE:-0}" = "1" ]; then
      __deeting_osc133_emit "D;$status"
      __DEETING_OSC133_COMMAND_ACTIVE=0
    fi
    __deeting_osc133_emit "A;$(__deeting_osc133_pwd_payload)"
    __DEETING_OSC133_PROMPT_READY=1
  }
  trap '__deeting_osc133_debug' DEBUG
  PROMPT_COMMAND="__deeting_osc133_prompt${SHELL_DOLLAR}{PROMPT_COMMAND:+;$PROMPT_COMMAND}"
fi
`;

export function buildTerminalBridgeText(
  snapshot: TerminalCommandSnapshot,
  intent: "command" | "output" | "diagnose-error",
): string {
  const commandBlock = snapshot.command
    ? ["Command:", "```shell", snapshot.command, "```"].join("\n")
    : "Command: unavailable";
  const outputBlock = snapshot.output
    ? ["Output:", "```", snapshot.output, "```"].join("\n")
    : "Output: unavailable";
  const statusLine =
    typeof snapshot.exitCode === "number"
      ? `Exit code: ${snapshot.exitCode}`
      : "Exit code: unknown";
  const streamLine = snapshot.stream ? `Stream: ${snapshot.stream}` : null;

  if (intent === "command") {
    return snapshot.command
      ? ["```shell", snapshot.command, "```"].join("\n")
      : commandBlock;
  }

  if (intent === "diagnose-error") {
    return [
      "Diagnose this terminal command failure.",
      commandBlock,
      statusLine,
      streamLine,
      outputBlock,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  return [commandBlock, statusLine, streamLine, outputBlock]
    .filter(Boolean)
    .join("\n\n");
}

export async function injectOsc133ShellIntegration(
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>,
  sessionId: string,
) {
  const platform = await resolveTerminalPlatform();
  if (platform === "windows") {
    return;
  }
  await invoke("pty_write", {
    sessionId,
    data: buildOsc133ShellIntegrationInput(platform),
  });
}

export function buildOsc133ShellIntegrationInput(
  platform: "windows" | "posix",
): string {
  if (platform === "windows") {
    return `Invoke-Expression ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("${encodeBase64Utf8(
      POWERSHELL_OSC_133_INIT_SCRIPT,
    )}")))\r`;
  }
  return `${POSIX_OSC_133_INIT_SCRIPT}\n`;
}

function encodeBase64Utf8(value: string): string {
  return globalThis.btoa(encodeUtf8Binary(value));
}

function encodeUtf8Binary(value: string): string {
  if (typeof TextEncoder !== "undefined") {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return binary;
  }

  return encodeURIComponent(value).replace(
    /%([0-9A-F]{2})/g,
    (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

export async function resolveTerminalPlatform(): Promise<"windows" | "posix"> {
  try {
    const { platform } = await import("@tauri-apps/plugin-os");
    return platform() === "windows" ? "windows" : "posix";
  } catch {
    return navigator.userAgent.toLowerCase().includes("windows")
      ? "windows"
      : "posix";
  }
}
