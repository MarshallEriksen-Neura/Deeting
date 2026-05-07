import {
  buildOsc133ShellIntegrationInput,
  buildTerminalBridgeText,
} from "./terminal-shell-integration";

describe("terminal shell integration", () => {
  it("builds POSIX init input with literal shell parameter expansion", () => {
    const input = buildOsc133ShellIntegrationInput("posix");

    expect(input).toContain("${ZSH_VERSION:-}");
    expect(input).toContain("${BASH_VERSION:-}");
    expect(input).toContain("${PROMPT_COMMAND:+;$PROMPT_COMMAND}");
    expect(input).toContain("__deeting_osc133_pwd_payload");
    expect(input).toContain("__deeting_osc133_emit \"A;$(__deeting_osc133_pwd_payload)\"");
    expect(input).toContain("__deeting_osc133_emit \"D;$status\"");
    expect(input).toContain(
      "__deeting_osc133_emit \"C;command_base64=$(__deeting_osc133_encode",
    );
  });

  it("builds Windows init input as a base64 PowerShell bootstrap", () => {
    const input = buildOsc133ShellIntegrationInput("windows");

    expect(input).toMatch(/^Invoke-Expression/);
    expect(input).toContain("FromBase64String");
    expect(input.endsWith("\r")).toBe(true);

    const encoded = input.match(/FromBase64String\("([^"]+)"\)/)?.[1];
    expect(encoded).toBeTruthy();
    const decoded = globalThis.atob(encoded ?? "");
    expect(decoded).toContain('__deeting_osc133_emit "A;cwd_base64=');
    expect(decoded).toContain('__deeting_osc133_emit "D;$deetingExitCode"');
  });

  it("formats failed command diagnostics for the chat bridge", () => {
    const text = buildTerminalBridgeText(
      {
        id: 1,
        command: "npm test",
        output: "FAIL components/terminal",
        exitCode: 1,
        stream: "stderr",
        outputStartLine: 10,
        outputEndLine: 12,
      },
      "diagnose-error",
    );

    expect(text).toContain("Diagnose this terminal command failure.");
    expect(text).toContain("```shell\nnpm test\n```");
    expect(text).toContain("Exit code: 1");
    expect(text).toContain("Stream: stderr");
    expect(text).toContain("FAIL components/terminal");
  });
});
