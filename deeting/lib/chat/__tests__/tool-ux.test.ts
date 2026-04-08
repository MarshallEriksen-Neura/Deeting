import type { MessageBlock } from "@/lib/chat/message-protocol";
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
    ).toBe("Running Firecrawl Search");
  });
});
