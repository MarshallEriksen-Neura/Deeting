"use client";

import type { IDecoration, IDisposable, IMarker, Terminal } from "@xterm/xterm";

import {
  byteLength,
  clampTerminalCommandsForRequest,
  hasErrorLikeTerminalOutput,
  summarizeTerminalOutput,
  type TerminalContextCommand,
  type TerminalContextSnapshot,
} from "@/lib/terminal-context";

export interface TerminalCommandSnapshot {
  id: number;
  command: string | null;
  output: string;
  exitCode: number | null;
  stream: "stdout" | "stderr" | null;
  outputStartLine: number;
  outputEndLine: number;
}

interface TerminalCommandRecord {
  id: number;
  command: string | null;
  output: string;
  exitCode: number | null;
  stream: "stdout" | "stderr" | null;
  outputStartMarker: IMarker | null;
  outputEndMarker: IMarker | null;
  outputStartLine: number;
  outputEndLine: number;
  decoration: IDecoration | null;
}

interface TerminalContextSnapshotOptions {
  sessionId: string | null;
  shell: TerminalContextSnapshot["shell"];
  selectionText?: string;
}

interface Osc133Payload {
  kind: string;
  fields: Record<string, string>;
  positional: string[];
}

interface InstallOsc133Options {
  onCommandFailed?: (snapshot: TerminalCommandSnapshot) => void;
}

export interface TerminalCommandBoundaryTracker extends IDisposable {
  getLastCommand: () => TerminalCommandSnapshot | null;
  getContextSnapshot: (
    options: TerminalContextSnapshotOptions,
  ) => TerminalContextSnapshot;
}

const MAX_COMPLETED_RECORDS = 20;
const SUCCESS_DECORATION_COLOR = "#13261f";
const FAILURE_DECORATION_COLOR = "#2a1518";

export function installOsc133CommandBoundaries(
  term: Terminal,
  options: InstallOsc133Options = {},
): TerminalCommandBoundaryTracker {
  let nextId = 1;
  let current: TerminalCommandRecord | null = null;
  const completed: TerminalCommandRecord[] = [];
  let currentCwd: string | null = null;

  const getActiveBufferLine = () => {
    const buffer = term.buffer.active;
    return buffer.baseY + buffer.cursorY;
  };

  const toSnapshot = (
    record: TerminalCommandRecord,
  ): TerminalCommandSnapshot => ({
    id: record.id,
    command: record.command,
    output: record.output,
    exitCode: record.exitCode,
    stream: record.stream,
    outputStartLine: record.outputStartLine,
    outputEndLine: record.outputEndLine,
  });

  const rememberCompleted = (record: TerminalCommandRecord) => {
    completed.push(record);
    while (completed.length > MAX_COMPLETED_RECORDS) {
      const stale = completed.shift();
      stale?.decoration?.dispose();
      stale?.outputStartMarker?.dispose();
      stale?.outputEndMarker?.dispose();
    }
  };

  const toContextCommand = (
    record: TerminalCommandRecord,
    state: "completed" | "running",
  ): TerminalContextCommand => {
    const output =
      state === "running"
        ? extractBufferText(term, record.outputStartLine, getActiveBufferLine())
        : record.output;

    return {
      id: `cmd_${record.id}`,
      command: record.command,
      state,
      exitCode: record.exitCode,
      stream: record.stream,
      output,
      outputBytes: byteLength(output),
      outputSummary: summarizeTerminalOutput(output),
      hasErrorLikeOutput: hasErrorLikeTerminalOutput(record.command, output),
      startedLine: record.outputStartLine,
      endedLine:
        state === "running" ? getActiveBufferLine() : record.outputEndLine,
    };
  };

  const finishCurrent = (exitCode: number | null) => {
    if (!current) return;
    const record = current;
    current = null;

    record.exitCode = exitCode;
    record.outputEndMarker = safeRegisterMarker(term);
    record.outputEndLine = record.outputEndMarker?.line ?? getActiveBufferLine();
    record.output = extractBufferText(
      term,
      record.outputStartLine,
      record.outputEndLine,
    );
    record.decoration = decorateCommandOutput(term, record);
    rememberCompleted(record);

    if (typeof exitCode === "number" && exitCode !== 0) {
      options.onCommandFailed?.(toSnapshot(record));
    }
  };

  const handleOsc133 = (data: string) => {
    const payload = parseOsc133Payload(data);
    switch (payload.kind) {
      case "A": {
        currentCwd = readCwdFromPayload(payload) ?? currentCwd;
        if (current) finishCurrent(null);
        return true;
      }
      case "C": {
        if (current) finishCurrent(null);
        const marker = safeRegisterMarker(term);
        current = {
          id: nextId++,
          command: readCommandFromPayload(payload),
          output: "",
          exitCode: null,
          stream: readStreamFromPayload(payload),
          outputStartMarker: marker,
          outputEndMarker: null,
          outputStartLine: marker?.line ?? getActiveBufferLine(),
          outputEndLine: marker?.line ?? getActiveBufferLine(),
          decoration: null,
        };
        return true;
      }
      case "D": {
        finishCurrent(readExitCodeFromPayload(payload));
        return true;
      }
      default:
        return false;
    }
  };

  const oscDisposable = term.parser.registerOscHandler(133, handleOsc133);

  return {
    dispose: () => {
      oscDisposable.dispose();
      current?.decoration?.dispose();
      current?.outputStartMarker?.dispose();
      current?.outputEndMarker?.dispose();
      for (const record of completed) {
        record.decoration?.dispose();
        record.outputStartMarker?.dispose();
        record.outputEndMarker?.dispose();
      }
      current = null;
      completed.length = 0;
    },
    getLastCommand: () => {
      const record = completed[completed.length - 1];
      return record ? toSnapshot(record) : null;
    },
    getContextSnapshot: ({ sessionId, shell, selectionText }) => {
      const selection = selectionText?.trim()
        ? { text: selectionText, bytes: byteLength(selectionText) }
        : null;
      const commands = clampTerminalCommandsForRequest([
        ...completed.map((record) => toContextCommand(record, "completed")),
        ...(current ? [toContextCommand(current, "running")] : []),
      ]);
      const active = commands.find((command) => command.state === "running");

      return {
        version: 1,
        available: Boolean(sessionId || commands.length > 0 || selection),
        sessionId,
        shell,
        cwd: currentCwd,
        capturedAt: new Date().toISOString(),
        activeProcess: active
          ? {
              id: active.id,
              command: active.command,
              outputBytes: active.outputBytes,
              outputSummary: active.outputSummary,
            }
          : null,
        selection,
        commands,
      };
    },
  };
}

export function parseOsc133Payload(data: string): Osc133Payload {
  const [kind = "", ...parts] = data.split(";");
  const fields: Record<string, string> = {};
  const positional: string[] = [];

  for (const part of parts) {
    const separator = part.indexOf("=");
    if (separator <= 0) {
      positional.push(part);
      continue;
    }
    fields[part.slice(0, separator)] = part.slice(separator + 1);
  }

  return { kind, fields, positional };
}

export function readCommandFromPayload(payload: Osc133Payload): string | null {
  const encoded =
    payload.fields.command_base64 ??
    payload.fields.commandBase64 ??
    payload.fields.cmd_base64;
  if (encoded) {
    return decodeBase64Utf8(encoded);
  }

  const raw = payload.fields.command ?? payload.fields.cmd;
  if (!raw) return null;

  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function readCwdFromPayload(payload: Osc133Payload): string | null {
  const encoded =
    payload.fields.cwd_base64 ??
    payload.fields.cwdBase64 ??
    payload.fields.pwd_base64;
  if (encoded) {
    return decodeBase64Utf8(encoded);
  }

  const raw = payload.fields.cwd ?? payload.fields.pwd;
  if (!raw) return null;

  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function readStreamFromPayload(
  payload: Osc133Payload,
): "stdout" | "stderr" | null {
  const raw = (
    payload.fields.stream ??
    payload.fields.channel ??
    payload.fields.fd ??
    ""
  ).toLowerCase();
  if (raw === "stderr" || raw === "2") return "stderr";
  if (raw === "stdout" || raw === "1") return "stdout";
  return null;
}

function readExitCodeFromPayload(payload: Osc133Payload): number | null {
  const raw =
    payload.fields.exit ??
    payload.fields.exitCode ??
    payload.fields.status ??
    payload.fields.code ??
    payload.positional.find((part) => /^-?\d+$/.test(part));
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function decodeBase64Utf8(value: string): string | null {
  try {
    const binary = globalThis.atob(value);
    return decodeUtf8Binary(binary);
  } catch {
    return null;
  }
}

function decodeUtf8Binary(binary: string): string {
  if (typeof TextDecoder !== "undefined") {
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  const encoded = Array.from(binary, (char) =>
    `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`,
  ).join("");
  return decodeURIComponent(encoded);
}

function safeRegisterMarker(term: Terminal): IMarker | null {
  try {
    return term.registerMarker(0) ?? null;
  } catch {
    return null;
  }
}

function extractBufferText(
  term: Terminal,
  startLine: number,
  endLine: number,
): string {
  const buffer = term.buffer.active;
  const start = Math.max(0, Math.min(startLine, buffer.length - 1));
  const end = Math.max(start, Math.min(endLine, buffer.length - 1));
  const lines: string[] = [];

  for (let lineIndex = start; lineIndex <= end; lineIndex += 1) {
    const line = buffer.getLine(lineIndex);
    if (!line) continue;
    lines.push(line.translateToString(true));
  }

  return lines.join("\n").trim();
}

function decorateCommandOutput(
  term: Terminal,
  record: TerminalCommandRecord,
): IDecoration | null {
  const marker = record.outputStartMarker;
  if (!marker || marker.isDisposed) return null;

  const height = Math.max(1, record.outputEndLine - record.outputStartLine + 1);
  const failed = typeof record.exitCode === "number" && record.exitCode !== 0;

  try {
    return (
      term.registerDecoration({
        marker,
        width: Math.max(1, term.cols),
        height,
        backgroundColor: failed ? FAILURE_DECORATION_COLOR : SUCCESS_DECORATION_COLOR,
        layer: "bottom",
        overviewRulerOptions: {
          color: failed ? "#ef4444" : "#22c55e",
          position: "right",
        },
      }) ?? null
    );
  } catch {
    return null;
  }
}
