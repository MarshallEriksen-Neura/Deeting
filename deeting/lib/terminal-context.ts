"use client";

export interface TerminalContextCommand {
  id: string;
  command: string | null;
  state: "completed" | "running";
  exitCode: number | null;
  stream: "stdout" | "stderr" | null;
  output: string;
  outputBytes: number;
  outputSummary: string;
  hasErrorLikeOutput: boolean;
  startedLine: number;
  endedLine: number;
}

export interface TerminalContextSnapshot {
  version: 1;
  available: boolean;
  sessionId: string | null;
  shell: "powershell" | "posix" | "unknown";
  cwd: string | null;
  capturedAt: string;
  activeProcess: {
    id: string;
    command: string | null;
    outputBytes: number;
    outputSummary: string;
  } | null;
  selection: {
    text: string;
    bytes: number;
  } | null;
  commands: TerminalContextCommand[];
}

const MAX_COMMAND_OUTPUT_BYTES = 24_000;
const MAX_TOTAL_OUTPUT_BYTES = 72_000;
const SUMMARY_BYTES = 1_200;

export function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function truncateUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0 || byteLength(value) <= maxBytes) return value;
  let used = 0;
  let output = "";
  for (const char of value) {
    const size = byteLength(char);
    if (used + size > maxBytes) break;
    output += char;
    used += size;
  }
  return output;
}

export function tailUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0 || byteLength(value) <= maxBytes) return value;
  let used = 0;
  let output = "";
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const char = value[index] ?? "";
    const size = byteLength(char);
    if (used + size > maxBytes) break;
    output = char + output;
    used += size;
  }
  return output;
}

export function summarizeTerminalOutput(output: string): string {
  const trimmed = output.trim();
  if (!trimmed) return "";
  return tailUtf8(trimmed, SUMMARY_BYTES);
}

export function hasErrorLikeTerminalOutput(command: string | null, output: string): boolean {
  const haystack = `${command ?? ""}\n${output}`.toLowerCase();
  return /\b(error|failed|exception|traceback|panic|fatal|denied|not found|cannot find|exit code)\b/.test(
    haystack,
  );
}

export function clampTerminalCommandsForRequest(
  commands: TerminalContextCommand[],
): TerminalContextCommand[] {
  let total = 0;
  const kept: TerminalContextCommand[] = [];
  for (const command of [...commands].reverse()) {
    const output = tailUtf8(command.output, MAX_COMMAND_OUTPUT_BYTES);
    const next: TerminalContextCommand = {
      ...command,
      output,
      outputBytes: byteLength(output),
      outputSummary: summarizeTerminalOutput(output),
      hasErrorLikeOutput: command.hasErrorLikeOutput,
    };
    total += next.outputBytes;
    if (total > MAX_TOTAL_OUTPUT_BYTES && kept.length > 0) break;
    kept.push(next);
  }
  return kept.reverse();
}
