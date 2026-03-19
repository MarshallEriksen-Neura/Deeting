import { render, screen } from "@testing-library/react"

const mockUseSearchParams = jest.fn()
const mockStartDesktopBrowserLogin = jest.fn()

jest.mock("next/navigation", () => ({
  useSearchParams: () => mockUseSearchParams(),
}))

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}))

jest.mock("@/lib/api/desktop-config", () => ({
  isTauriRuntime: () => true,
}))

jest.mock("@/hooks/use-auth", () => ({
  useAuthService: () => ({
    startDesktopBrowserLogin: mockStartDesktopBrowserLogin,
    refreshMutation: { trigger: jest.fn() },
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
    emailForm: {},
    codeForm: {},
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
})
