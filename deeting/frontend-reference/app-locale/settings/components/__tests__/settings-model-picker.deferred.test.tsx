describe("Settings model picker deferral", () => {
  beforeEach(() => {
    jest.resetModules()
  })

  it("does not eagerly import the model picker when loading settings model cards", () => {
    let modelPickerLoads = 0

    jest.isolateModules(() => {
      jest.doMock("next/dynamic", () => ({
        __esModule: true,
        default: () => () => null,
      }))
      jest.doMock("react-hook-form", () => ({
        useWatch: () => "cloudflare_r2_s3",
      }))
      jest.doMock("@/hooks/use-i18n", () => ({
        useI18n: () => (key: string) => key,
      }))
      jest.doMock("@/components/ui/glass-card", () => ({
        GlassCard: ({ children }: { children?: React.ReactNode }) => children ?? null,
        GlassCardContent: ({ children }: { children?: React.ReactNode }) => children ?? null,
        GlassCardDescription: ({ children }: { children?: React.ReactNode }) => children ?? null,
        GlassCardFooter: ({ children }: { children?: React.ReactNode }) => children ?? null,
        GlassCardHeader: ({ children }: { children?: React.ReactNode }) => children ?? null,
        GlassCardTitle: ({ children }: { children?: React.ReactNode }) => children ?? null,
      }))
      jest.doMock("@/components/ui/glass-button", () => ({
        GlassButton: ({ children }: { children?: React.ReactNode }) => children ?? null,
      }))
      jest.doMock("@/components/ui/badge", () => ({
        Badge: ({ children }: { children?: React.ReactNode }) => children ?? null,
      }))
      jest.doMock("@/components/ui/form", () => ({
        FormControl: ({ children }: { children?: React.ReactNode }) => children ?? null,
        FormDescription: ({ children }: { children?: React.ReactNode }) => children ?? null,
        FormField: ({ render }: { render: (props: { field: { value: string; onChange: jest.Mock } }) => React.ReactNode }) =>
          render({ field: { value: "", onChange: jest.fn() } }),
        FormItem: ({ children }: { children?: React.ReactNode }) => children ?? null,
        FormLabel: ({ children }: { children?: React.ReactNode }) => children ?? null,
      }))
      jest.doMock("@/components/ui/popover", () => ({
        Popover: ({ children }: { children?: React.ReactNode }) => children ?? null,
        PopoverContent: ({ children }: { children?: React.ReactNode }) => children ?? null,
        PopoverTrigger: ({ children }: { children?: React.ReactNode }) => children ?? null,
      }))
      jest.doMock("@/components/ui/input", () => ({
        Input: () => null,
      }))
      jest.doMock("@/components/ui/select", () => ({
        Select: ({ children }: { children?: React.ReactNode }) => children ?? null,
        SelectContent: ({ children }: { children?: React.ReactNode }) => children ?? null,
        SelectItem: ({ children }: { children?: React.ReactNode }) => children ?? null,
        SelectTrigger: ({ children }: { children?: React.ReactNode }) => children ?? null,
        SelectValue: () => null,
      }))
      jest.doMock("@/components/ui/switch", () => ({
        Switch: () => null,
      }))
      jest.doMock("@/components/models/model-visual", () => ({
        resolveModelVisual: () => ({
          icon: () => null,
          color: "text-foreground",
          indicator: "bg-foreground",
        }),
      }))
      jest.doMock("@/components/models/model-picker", () => {
        modelPickerLoads += 1
        return { ModelPicker: () => null }
      })

      require("../personal-settings-card")
      require("../desktop-embedding-settings-card")
    })

    expect(modelPickerLoads).toBe(0)
  })
})
