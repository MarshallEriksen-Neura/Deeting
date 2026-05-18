import { render, screen } from "@testing-library/react"

import { IslandSelectionPanel } from "./island-selection-panel"
import type { IslandSelectionContext } from "./selection-context-types"

jest.mock("./island-translate-config-sheet", () => ({
  IslandTranslateConfigSheet: () => null,
}))

const islandMessages = {
  "selection.title": "已选文本",
  "selection.charCount": "{count} 字符",
  "selection.truncated": "已截断",
  "selection.empty": "没有检测到选中文本。",
  "selection.dismiss": "关闭选中文本",
  "selection.translateTo": "翻译为 {target}",
  "selection.translateOptions": "更多翻译选项",
  "selection.actions.translate": "翻译",
  "selection.actions.explain": "解释",
  "selection.actions.summarize": "总结",
  "selection.actions.ask": "提问",
  "selection.actions.search": "搜索",
  "selection.actions.copy": "复制",
  "selection.sources.accessibility": "原生选区",
  "selection.sources.clipboard_fallback": "剪贴板兜底",
  "selection.sources.unavailable": "未检测到选区",
  "selection.translateRecent": "最近使用",
  "selection.translatePopular": "常用语种",
  "selection.translateFavorites": "我的收藏",
  "selection.translateManage": "管理收藏…",
  "selection.customTarget": "其他语言…",
  "selection.translateApply": "翻译",
} as const

jest.mock("@/hooks/use-i18n", () => ({
  useI18n: (namespace?: string) => {
    if (namespace !== "island") {
      throw new Error(`unexpected namespace: ${namespace ?? "undefined"}`)
    }

    return (key: string, values?: Record<string, string | number>) => {
      const template = islandMessages[key as keyof typeof islandMessages]
      if (!template) {
        throw new Error(`missing mock translation for ${key}`)
      }

      if (!values) return template
      return Object.entries(values).reduce(
        (message, [name, value]) => message.replace(`{${name}}`, String(value)),
        template,
      )
    }
  },
}))

const selection: IslandSelectionContext = {
  selectionId: "selection-1",
  text: "algorithm",
  preview: "algorithm",
  source: "clipboard_fallback",
  capturedAt: 1,
  charCount: 9,
  truncated: false,
  activeAction: null,
  detectedLanguage: { code: "en", displayName: "English" },
}

describe("IslandSelectionPanel zh-CN messages", () => {
  it("renders selection source and action labels without double island namespace", () => {
    render(
      <IslandSelectionPanel
        selection={selection}
        isBusy={false}
        onOpenTranslator={jest.fn()}
        onRunAction={jest.fn()}
        onDismiss={jest.fn()}
      />,
    )

    expect(
      screen.getAllByText((_, element) =>
        element?.textContent?.includes("剪贴板兜底") ?? false,
      ).length,
    ).toBeGreaterThan(0)
    expect(screen.getByText("解释")).not.toBeNull()
    expect(screen.getByText("搜索")).not.toBeNull()
  })
})
