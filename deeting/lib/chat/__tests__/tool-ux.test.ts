import type { MessageBlock } from "@/lib/chat/message-protocol";
import { deriveAssistantActivityState } from "@/lib/chat/assistant-activity";
import {
  humanizeToolName,
  resolveToolActionPreview,
  resolveToolPreview,
  resolveToolResultPreview,
  resolveToolStatusDetail,
  summarizeToolCalls,
} from "@/lib/chat/tool-ux";

describe("tool-ux helpers", () => {
  type PreviewTranslator = NonNullable<
    Parameters<typeof resolveToolActionPreview>[3]
  >;

  const previewTranslator = ((key: string, values?: Record<string, unknown>) => {
    switch (key) {
      case "toolGroup.preview.fallbackName":
        return "工具";
      case "toolGroup.preview.searchFor":
        return `正在搜索“${values?.value as string}”`;
      case "toolGroup.preview.returnedStructuredData":
        return "返回了结构化数据";
      default:
        return key;
    }
  }) as PreviewTranslator;

  it("humanizes unknown tool ids", () => {
    expect(humanizeToolName("firecrawl_search")).toBe("Firecrawl Search");
    expect(humanizeToolName("run_local_code_snippet")).toBe("Local Code Run");
    expect(
      humanizeToolName("skill.official.skills.crawler.fetch_web_content"),
    ).toBe("Crawler Fetch Web Content");
  });

  it("builds action previews from tool args", () => {
    expect(
      resolveToolActionPreview(
        "firecrawl_search",
        '{"query":"Gemma 4 Windows deployment"}',
        "running",
      ),
    ).toBe('Searching for "Gemma 4 Windows deployment"');
  });

  it("builds result previews from generic structured results", () => {
    expect(
      resolveToolResultPreview({
        name: "firecrawl_search",
        result: {
          results: [{ title: "A" }, { title: "B" }],
        },
      }),
    ).toBe("Found 2 results");
  });

  it("builds local snippet previews from structured snippet results", () => {
    expect(
      resolveToolResultPreview({
        name: "run_local_code_snippet",
        result: {
          success: true,
          status: "success",
          language: "python",
        },
      }),
    ).toBe("Ran local PYTHON snippet");
  });

  it("localizes action previews when a translator is provided", () => {
    expect(
      resolveToolActionPreview(
        "firecrawl_search",
        '{"query":"Gemma 4 Windows deployment"}',
        "running",
        previewTranslator,
      ),
    ).toBe("正在搜索“Gemma 4 Windows deployment”");
  });

  it("localizes structured result fallback previews when a translator is provided", () => {
    expect(
      resolveToolResultPreview({
        name: "custom_tool",
        result: { ok: true },
        translate: previewTranslator,
      }),
    ).toBe("返回了结构化数据");
  });

  it("prefers provided preview before generic fallbacks", () => {
    expect(
      resolveToolPreview({
        name: "shell_execute",
        preferredPreview: "powershell.exe · exit 0",
        result: { stdout: "ok" },
      }),
    ).toBe("powershell.exe · exit 0");
  });

  it("summarizes grouped tool calls with humanized labels", () => {
    const summary = summarizeToolCalls([
      {
        id: "1",
        type: "tool_call",
        toolName: "firecrawl_search",
      } as MessageBlock,
      { id: "2", type: "tool_call", toolName: "search_sdk" } as MessageBlock,
    ]);

    expect(summary).toMatchObject({
      totalCalls: 2,
      highlights: "Firecrawl Search · SDK Search",
      allInternal: false,
    });
  });

  it("builds humanized status detail for island/tool status surfaces", () => {
    expect(
      resolveToolStatusDetail("approval.executing", {
        tool_name: "firecrawl_search",
      }),
    ).toBe("Approved, now running Firecrawl Search");
  });

  it("uses execution target names for approval-required graph status", () => {
    expect(
      resolveToolStatusDetail("approval.required", {
        target_name: "Research Worker",
      }),
    ).toBe("Waiting for approval to continue with Research Worker");
  });

  it("falls back to a generic approval-required label without a tool or target name", () => {
    expect(resolveToolStatusDetail("approval.required", {})).toBe(
      "Waiting for your approval",
    );
  });

  it("keeps approval-required activity active when a newer approval block reuses a previously successful call id", () => {
    expect(
      deriveAssistantActivityState([
        {
          id: "call-shared-1",
          type: "tool_call",
          callId: "call-shared-1",
          toolName: "firecrawl_browser_execute",
          status: "running",
        } as MessageBlock,
        {
          id: "result-shared-success-1",
          type: "tool_result",
          callId: "call-shared-1",
          toolName: "firecrawl_browser_execute",
          status: "success",
          result: { ok: true },
        } as MessageBlock,
        {
          id: "result-shared-pending-1",
          type: "tool_result",
          callId: "call-shared-1",
          toolName: "firecrawl_browser_execute",
          status: "requires_approval",
          result: {
            status: "REQUIRES_APPROVAL",
            approval_token: "approval-shared-next-1",
          },
        } as MessageBlock,
      ]).statusCode,
    ).toBe("approval.required");
  });
});
