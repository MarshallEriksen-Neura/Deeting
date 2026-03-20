import { render, screen } from "@testing-library/react"

const mockUseSearchParams = jest.fn()
const mockStartDesktopBrowserLogin = jest.fn()
const mockIsTauriRuntime = jest.fn()

jest.mock("next/navigation", () => ({
  useSearchParams: () => mockUseSearchParams(),
}))

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}))

jest.mock("@/components/ui/form", () => ({
  Form: ({ children }: { children: any }) => <>{children}</>,
  FormField: ({
    render,
    name,
  }: {
    render: (props: { field: Record<string, unknown> }) => any
    name: string
  }) =>
    render({
      field: {
        name,
        value: "",
        onChange: jest.fn(),
        onBlur: jest.fn(),
        ref: jest.fn(),
      },
    }),
  FormItem: ({ children }: { children: any }) => <div>{children}</div>,
  FormLabel: ({ children }: { children: any }) => <label>{children}</label>,
  FormControl: ({ children }: { children: any }) => <>{children}</>,
  FormMessage: () => null,
}))

jest.mock("@/lib/api/desktop-config", () => ({
  isTauriRuntime: () => mockIsTauriRuntime(),
}))

jest.mock("@/hooks/use-auth", () => ({
  useAuthService: () => ({
    startDesktopBrowserLogin: mockStartDesktopBrowserLogin,
    startDesktopOAuthLogin: jest.fn(),
    refreshMutation: { trigger: jest.fn().mockResolvedValue(undefined) },
    completeDesktopBrowserLogin: jest.fn(),
  }),
}))

jest.mock("@/store/auth-store", () => ({
  useAuthStore: (selector: (state: { isAuthenticated: boolean }) => unknown) =>
    selector({ isAuthenticated: false }),
}))

jest.mock("@/hooks/use-login-form", () => ({
  useLoginForm: () => ({
    step: "email",
    setStep: jest.fn(),
    email: "",
    inviteCode: "",
    showInviteCode: false,
    setShowInviteCode: jest.fn(),
    countdown: 0,
    isLoading: false,
    emailForm: {
      handleSubmit: (handler: (...args: unknown[]) => unknown) => (event?: { preventDefault?: () => void }) => {
        event?.preventDefault?.()
        return handler({})
      },
      control: {},
    },
    codeForm: {
      handleSubmit: (handler: (...args: unknown[]) => unknown) => (event?: { preventDefault?: () => void }) => {
        event?.preventDefault?.()
        return handler({})
      },
      control: {},
    },
    handleSendCode: jest.fn(),
    handleVerifyCode: jest.fn(),
    handleResendCode: jest.fn(),
    captchaRef: { current: null },
    setCaptchaToken: jest.fn(),
  }),
}))

jest.mock("@marsidev/react-turnstile", () => ({
  Turnstile: () => null,
}))

describe("LoginForm desktop convergence", () => {
  beforeAll(() => {
    process.env.NEXT_PUBLIC_DESKTOP_EXTERNAL_LOGIN_URL = "https://app.example.com/login"
  })

  beforeEach(() => {
    mockIsTauriRuntime.mockReturnValue(true)
    mockUseSearchParams.mockReturnValue({
      get: () => null,
    })
  })

  it("shows only browser login entry on desktop", async () => {
    const { LoginForm } = await import("../login-form")

    render(<LoginForm />)

    expect(screen.getByText("desktopBrowserAction")).toBeInTheDocument()
    expect(screen.queryByText("oauthGoogle")).not.toBeInTheDocument()
    expect(screen.queryByText("oauthGithub")).not.toBeInTheDocument()
  })

  it("shows google and github login actions on the browser handoff page", async () => {
    mockIsTauriRuntime.mockReturnValue(false)
    mockUseSearchParams.mockReturnValue({
      get: (key: string) => (key === "desktop_login_session" ? "sess-1" : null),
    })

    const { LoginForm } = await import("../login-form")

    render(<LoginForm />)

    expect(screen.getByText("oauthGoogle")).toBeInTheDocument()
    expect(screen.getByText("oauthGithub")).toBeInTheDocument()
    expect(screen.getByText("oauthLinuxdo")).toBeInTheDocument()
    expect(screen.getByText("sendCode")).toBeInTheDocument()
  })
})
