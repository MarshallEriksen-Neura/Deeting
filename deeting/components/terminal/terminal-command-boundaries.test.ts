import {
  installOsc133CommandBoundaries,
  parseOsc133Payload,
  readCommandFromPayload,
} from "./terminal-command-boundaries";
import type { Terminal } from "@xterm/xterm";

describe("OSC 133 command boundary helpers", () => {
  it("parses command-start payload fields and positional exit status", () => {
    const payload = parseOsc133Payload(
      "C;command=git%20status;stream=stderr;extra=value",
    );

    expect(payload.kind).toBe("C");
    expect(payload.fields.command).toBe("git%20status");
    expect(payload.fields.stream).toBe("stderr");
    expect(payload.fields.extra).toBe("value");

    const done = parseOsc133Payload("D;127");
    expect(done.kind).toBe("D");
    expect(done.positional).toEqual(["127"]);
  });

  it("decodes command payloads from url-encoded and base64 forms", () => {
    expect(readCommandFromPayload(parseOsc133Payload("C;command=npm%20test"))).toBe(
      "npm test",
    );

    const encoded = globalThis.btoa("echo hello && exit 1");
    expect(
      readCommandFromPayload(
        parseOsc133Payload(`C;command_base64=${encoded}`),
      ),
    ).toBe("echo hello && exit 1");
  });

  it("tracks a completed failed command and decorates its output range", () => {
    const terminal = createFakeTerminal([
      "$ npm test",
      "FAIL components/terminal",
      "Tests: 1 failed",
    ]);
    const failures: Array<{
      command: string | null;
      output: string;
      exitCode: number | null;
    }> = [];
    const tracker = installOsc133CommandBoundaries(terminal.term, {
      onCommandFailed: (snapshot) => failures.push(snapshot),
    });

    terminal.emitOsc("C;command=npm%20test;stream=stderr", 1);
    terminal.emitOsc("D;1", 2);

    expect(tracker.getLastCommand()).toMatchObject({
      command: "npm test",
      output: "FAIL components/terminal\nTests: 1 failed",
      exitCode: 1,
      stream: "stderr",
      outputStartLine: 1,
      outputEndLine: 2,
    });
    expect(failures).toHaveLength(1);
    expect(terminal.decorations).toEqual([
      expect.objectContaining({
        height: 2,
        backgroundColor: "rgba(239, 68, 68, 0.10)",
      }),
    ]);

    tracker.dispose();
  });
});

function createFakeTerminal(lines: string[]) {
  let cursorY = 0;
  let nextMarkerId = 1;
  let oscHandler: ((data: string) => boolean | Promise<boolean>) | null = null;
  const decorations: unknown[] = [];
  const disposed: number[] = [];

  const term = {
    cols: 80,
    buffer: {
      active: {
        baseY: 0,
        get cursorY() {
          return cursorY;
        },
        length: lines.length,
        getLine: (lineIndex: number) => ({
          translateToString: () => lines[lineIndex] ?? "",
        }),
      },
    },
    parser: {
      registerOscHandler: (
        ident: number,
        handler: (data: string) => boolean | Promise<boolean>,
      ) => {
        expect(ident).toBe(133);
        oscHandler = handler;
        return { dispose: () => undefined };
      },
    },
    registerMarker: () => {
      const id = nextMarkerId;
      nextMarkerId += 1;
      return {
        id,
        line: cursorY,
        isDisposed: false,
        dispose: () => disposed.push(id),
        onDispose: () => ({ dispose: () => undefined }),
      };
    },
    registerDecoration: (options: unknown) => {
      decorations.push(options);
      return {
        marker: {},
        element: undefined,
        options: {},
        isDisposed: false,
        dispose: () => undefined,
        onDispose: () => ({ dispose: () => undefined }),
        onRender: () => ({ dispose: () => undefined }),
      };
    },
  };

  return {
    decorations,
    disposed,
    term: term as unknown as Terminal,
    emitOsc: (payload: string, line: number) => {
      if (!oscHandler) throw new Error("OSC handler was not registered");
      cursorY = line;
      return oscHandler(payload);
    },
  };
}
