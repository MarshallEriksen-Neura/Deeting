describe("SettingsForm deferred sections", () => {
  beforeEach(() => {
    jest.resetModules()
  })

  it("does not eagerly import non-model settings sections on initial module load", () => {
    let agentCardLoads = 0
    let browserPanelLoads = 0
    let sandboxCardLoads = 0
    let storageCardLoads = 0
    let scoutCardLoads = 0
    let versionCardLoads = 0

    jest.isolateModules(() => {
      jest.doMock("next/dynamic", () => ({
        __esModule: true,
        default: () => () => null,
      }))
      jest.doMock("react-hook-form", () => ({
        useForm: () => ({
          control: {},
          handleSubmit: (fn: (...args: unknown[]) => unknown) => fn,
          formState: { isSubmitting: false },
          reset: jest.fn(),
          setValue: jest.fn(),
          getValues: jest.fn(() => ({})),
        }),
      }))
      jest.doMock("sonner", () => ({
        toast: { success: jest.fn(), error: jest.fn() },
      }))
      jest.doMock("@/components/ui/form", () => ({
        Form: ({ children }: { children?: React.ReactNode }) => children ?? null,
      }))
      jest.doMock("@/components/ui/progress", () => ({
        Progress: () => null,
      }))
      jest.doMock("@/components/ui/glass-button", () => ({
        GlassButton: ({ children }: { children?: React.ReactNode }) => children ?? null,
      }))
      jest.doMock("@/components/ui/alert-dialog", () => ({
        AlertDialog: ({ children }: { children?: React.ReactNode }) => children ?? null,
        AlertDialogAction: ({ children }: { children?: React.ReactNode }) => children ?? null,
        AlertDialogCancel: ({ children }: { children?: React.ReactNode }) => children ?? null,
        AlertDialogContent: ({ children }: { children?: React.ReactNode }) => children ?? null,
        AlertDialogDescription: ({ children }: { children?: React.ReactNode }) => children ?? null,
        AlertDialogFooter: ({ children }: { children?: React.ReactNode }) => children ?? null,
        AlertDialogHeader: ({ children }: { children?: React.ReactNode }) => children ?? null,
        AlertDialogTitle: ({ children }: { children?: React.ReactNode }) => children ?? null,
      }))
      jest.doMock("@/hooks/use-i18n", () => ({
        useI18n: () => (key: string) => key,
      }))
      jest.doMock("@/hooks/use-chat-service", () => ({
        useChatService: () => ({ modelGroups: [], isLoadingModels: false }),
      }))
      jest.doMock("@/lib/api/local-embedding-rebuild", () => ({
        LOCAL_EMBEDDING_REBUILD_PROGRESS_EVENT: "progress",
        rebuildLocalEmbeddingAssets: jest.fn(),
      }))
      jest.doMock("@/lib/api/desktop-system-assets", () => ({
        runLocalMaintenanceAction: jest.fn(),
      }))
      jest.doMock("@/lib/api/secretary", () => ({
        updateUserSecretary: jest.fn(),
      }))
      jest.doMock("@/lib/api/user-embedding-config", () => ({
        updateUserEmbeddingConfig: jest.fn(),
      }))
      jest.doMock("@/lib/swr/use-embedding-settings", () => ({
        useUserSecretary: () => ({ data: null, isLoading: false, mutate: jest.fn() }),
        useUserEmbeddingConfig: () => ({ data: null, isLoading: false, mutate: jest.fn() }),
      }))
      jest.doMock("../desktop-embedding-settings-card", () => ({
        DesktopEmbeddingSettingsCard: () => null,
      }))
      jest.doMock("../personal-settings-card", () => ({
        PersonalSettingsCard: () => null,
      }))
      jest.doMock("../settings-form-actions", () => ({
        SettingsFormActions: () => null,
      }))
      jest.doMock("../settings-nav", () => ({
        SettingsNav: () => null,
      }))
      jest.doMock("../agent-settings-card", () => {
        agentCardLoads += 1
        return { AgentSettingsCard: () => null }
      })
      jest.doMock("../desktop-sandbox-settings-card", () => {
        sandboxCardLoads += 1
        return { DesktopSandboxSettingsCard: () => null }
      })
      jest.doMock("../desktop-version-management-card", () => {
        versionCardLoads += 1
        return { DesktopVersionManagementCard: () => null }
      })
      jest.doMock("../desktop-browser-agent-panel-card", () => {
        browserPanelLoads += 1
        return { DesktopBrowserAgentPanelCard: () => null }
      })
      jest.doMock("../desktop-object-storage-settings-card", () => {
        storageCardLoads += 1
        return { DesktopObjectStorageSettingsCard: () => null }
      })
      jest.doMock("../desktop-scout-settings-card", () => {
        scoutCardLoads += 1
        return { DesktopScoutSettingsCard: () => null }
      })

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("../settings-form")
    })

    expect(agentCardLoads).toBe(0)
    expect(browserPanelLoads).toBe(0)
    expect(sandboxCardLoads).toBe(0)
    expect(storageCardLoads).toBe(0)
    expect(scoutCardLoads).toBe(0)
    expect(versionCardLoads).toBe(0)
  })
})
