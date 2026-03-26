describe("HUD deferred surfaces", () => {
  beforeEach(() => {
    jest.resetModules()
  })

  it("does not eagerly import history and model picker surfaces on initial HUD load", () => {
    let historySidebarLoads = 0
    let modelPickerLoads = 0
    let controlCenterPanelLoads = 0
    let systemMenuPanelLoads = 0

    jest.isolateModules(() => {
      jest.doMock("next/dynamic", () => ({
        __esModule: true,
        default: () => () => null,
      }))
      jest.doMock("framer-motion", () => ({
        motion: {
          div: ({ children }: { children?: React.ReactNode }) => children ?? null,
        },
        AnimatePresence: ({ children }: { children?: React.ReactNode }) => children ?? null,
      }))
      jest.doMock("next-themes", () => ({
        useTheme: () => ({ theme: "dark", setTheme: jest.fn() }),
      }))
      jest.doMock("next/navigation", () => ({
        usePathname: () => "/chat",
        useSearchParams: () => new URLSearchParams(""),
      }))
      jest.doMock("@/i18n/routing", () => ({
        Link: ({ children }: { children?: React.ReactNode }) => children ?? null,
      }))
      jest.doMock("@/components/ui/button", () => ({
        Button: ({ children }: { children?: React.ReactNode }) => children ?? null,
      }))
      jest.doMock("@/components/ui/status-pill", () => ({
        StatusPill: () => null,
      }))
      jest.doMock("@/hooks/use-i18n", () => ({
        useI18n: () => (key: string) => key,
      }))
      jest.doMock("@/hooks/use-chat-service", () => ({
        useChatService: () => ({
          models: [],
          modelGroups: [],
          isLoadingModels: false,
        }),
      }))
      jest.doMock("@/store/chat-store", () => ({
        useChatStore: () => ({
          config: { model: "" },
          setConfig: jest.fn(),
          selectedAssistant: null,
          models: [],
          selectedAssistantId: null,
          setSelectedAssistant: jest.fn(),
          setModels: jest.fn(),
          setSelectedAssistantId: jest.fn(),
          clearSelectedAssistantId: jest.fn(),
          setMessages: jest.fn(),
          clearAttachments: jest.fn(),
          isLoading: false,
          errorMessage: null,
          statusCode: null,
          statusMeta: null,
          resetSession: jest.fn(),
          setSessionId: jest.fn(),
          setGlobalLoading: jest.fn(),
        }),
      }))
      jest.doMock("@/lib/runtime/tauri", () => ({
        isTauriRuntime: () => false,
      }))
      jest.doMock("@/lib/chat/status-detail", () => ({
        resolveStatusDetail: () => null,
      }))
      jest.doMock("@/lib/api/conversations", () => ({
        createConversation: jest.fn(),
      }))
      jest.doMock("@/components/chat/sidebar/history-sidebar", () => {
        historySidebarLoads += 1
        return { HistorySidebar: () => null }
      })
      jest.doMock("@/components/models/model-picker", () => {
        modelPickerLoads += 1
        return {
          ModelPicker: () => null,
          resolveModelVisual: () => ({
            icon: () => null,
            color: "text-black/40",
            indicator: "bg-black/30",
          }),
        }
      })
      jest.doMock("../hud-control-center-panel", () => {
        controlCenterPanelLoads += 1
        return { HudControlCenterPanel: () => null }
      })
      jest.doMock("../hud-system-menu-panel", () => {
        systemMenuPanelLoads += 1
        return { HudSystemMenuPanel: () => null }
      })

      require("../hud-container")
    })

    expect(historySidebarLoads).toBe(0)
    expect(modelPickerLoads).toBe(0)
    expect(controlCenterPanelLoads).toBe(0)
    expect(systemMenuPanelLoads).toBe(0)
  })

  it("requests chat-capable models for the HUD selector", () => {
    const useChatService = jest.fn(() => ({
      models: [],
      modelGroups: [],
      isLoadingModels: false,
    }))

    jest.isolateModules(() => {
      jest.doMock("react", () => {
        const actual = jest.requireActual("react")
        return {
          ...actual,
          useState: jest.fn((initial) => [initial, jest.fn()]),
          useEffect: jest.fn((effect) => effect()),
          useMemo: jest.fn((factory) => factory()),
          useCallback: jest.fn((callback) => callback),
        }
      })
      jest.doMock("next/dynamic", () => ({
        __esModule: true,
        default: () => () => null,
      }))
      jest.doMock("framer-motion", () => ({
        motion: {
          div: ({ children }: { children?: React.ReactNode }) => children ?? null,
        },
        AnimatePresence: ({ children }: { children?: React.ReactNode }) => children ?? null,
      }))
      jest.doMock("next-themes", () => ({
        useTheme: () => ({ theme: "dark", setTheme: jest.fn() }),
      }))
      jest.doMock("next/navigation", () => ({
        usePathname: () => "/chat",
        useSearchParams: () => new URLSearchParams(""),
      }))
      jest.doMock("@/i18n/routing", () => ({
        Link: ({ children }: { children?: React.ReactNode }) => children ?? null,
      }))
      jest.doMock("@/components/ui/button", () => ({
        Button: ({ children }: { children?: React.ReactNode }) => children ?? null,
      }))
      jest.doMock("@/components/ui/status-pill", () => ({
        StatusPill: () => null,
      }))
      jest.doMock("@/components/models/model-visual", () => ({
        resolveModelVisual: () => ({
          indicator: "bg-black/30",
        }),
      }))
      jest.doMock("@/hooks/use-i18n", () => ({
        useI18n: () => (key: string) => key,
      }))
      jest.doMock("@/hooks/use-chat-service", () => ({
        useChatService,
      }))
      jest.doMock("zustand/react/shallow", () => ({
        useShallow: (selector: unknown) => selector,
      }))
      jest.doMock("@/store/chat-store", () => ({
        useChatStore: () => ({
          config: { model: "" },
          setConfig: jest.fn(),
          selectedAssistant: null,
          models: [],
          selectedAssistantId: null,
          setSelectedAssistant: jest.fn(),
          setModels: jest.fn(),
          setSelectedAssistantId: jest.fn(),
          clearSelectedAssistantId: jest.fn(),
          setMessages: jest.fn(),
          clearAttachments: jest.fn(),
          isLoading: false,
          errorMessage: null,
          statusCode: null,
          statusMeta: null,
          resetSession: jest.fn(),
          setSessionId: jest.fn(),
          setGlobalLoading: jest.fn(),
        }),
      }))
      jest.doMock("@/lib/runtime/tauri", () => ({
        isTauriRuntime: () => false,
      }))
      jest.doMock("@/lib/chat/status-detail", () => ({
        resolveStatusDetail: () => null,
      }))
      jest.doMock("@/lib/api/conversations", () => ({
        createConversation: jest.fn(),
      }))
      jest.doMock("../hud-lazy", () => ({
        DeferredHistorySidebar: () => null,
        DeferredHudControlCenterPanel: () => null,
        DeferredHudSystemMenuPanel: () => null,
        preloadHudDeferredSurfaces: jest.fn(),
      }))

      const HUD = require("../hud-container").default
      HUD()
    })

    expect(useChatService).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        fetchAssistants: false,
        modelCapability: "chat",
      })
    )
  })
})
