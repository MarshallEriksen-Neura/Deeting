import React from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { AgentSettingsCard } from "../agent-settings-card"

const mockGetDesktopConfig = jest.fn()
const mockSetDesktopConfig = jest.fn()
const mockToastSuccess = jest.fn()
const mockToastError = jest.fn()

jest.mock("@/hooks/use-i18n", () => ({
  useI18n: () => (key: string, values?: Record<string, string | number>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}))

jest.mock("@/lib/api/desktop-config", () => ({
  DESKTOP_CONFIG_KEYS: {
    maxAgenticRounds: "max_agentic_rounds",
    personaPrompt: "chat.persona_prompt",
    chatHistoryRetentionDays: "chat.history_retention_days",
    approvalPolicyLevel: "chat.approval_policy_level",
  },
  normalizeDesktopApprovalPolicyLevel: (value: string | null | undefined) => {
    switch ((value ?? "").trim().toLowerCase()) {
      case "high":
        return "high"
      case "low":
        return "low"
      default:
        return "medium"
    }
  },
  getDesktopConfig: (...args: unknown[]) => mockGetDesktopConfig(...args),
  setDesktopConfig: (...args: unknown[]) => mockSetDesktopConfig(...args),
}))

jest.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

describe("AgentSettingsCard", () => {
  beforeEach(() => {
    mockGetDesktopConfig.mockReset()
    mockSetDesktopConfig.mockReset()
    mockToastSuccess.mockReset()
    mockToastError.mockReset()

    mockGetDesktopConfig.mockImplementation(async (key: string) => {
      if (key === "max_agentic_rounds") return "12"
      if (key === "chat.persona_prompt") return "Stay practical."
      if (key === "chat.history_retention_days") return "30"
      if (key === "chat.approval_policy_level") return "medium"
      return null
    })
    mockSetDesktopConfig.mockResolvedValue(undefined)
  })

  it("loads and saves desktop chat history retention", async () => {
    render(<AgentSettingsCard isTauriRuntime />)

    await waitFor(() => {
      expect(mockGetDesktopConfig).toHaveBeenCalledWith("chat.history_retention_days")
    })

    const retentionSelect = await screen.findByLabelText(
      "agent.chatHistoryRetentionLabel"
    )
    expect(retentionSelect).toHaveValue("30")

    fireEvent.change(retentionSelect, { target: { value: "90" } })

    fireEvent.click(
      screen.getByRole("button", {
        name: "agent.save",
      })
    )

    await waitFor(() => {
      expect(mockSetDesktopConfig).toHaveBeenCalledWith(
        "chat.history_retention_days",
        "90"
      )
    })

    expect(mockToastSuccess).toHaveBeenCalledWith("agent.saveSuccess")
  })

  it("loads and saves desktop approval policy level", async () => {
    render(<AgentSettingsCard isTauriRuntime />)

    const policySelect = await screen.findByLabelText("agent.approvalPolicyLabel")
    expect(policySelect).toHaveValue("medium")

    fireEvent.change(policySelect, { target: { value: "low" } })

    fireEvent.click(
      screen.getByRole("button", {
        name: "agent.save",
      })
    )

    await waitFor(() => {
      expect(mockSetDesktopConfig).toHaveBeenCalledWith(
        "chat.approval_policy_level",
        "low"
      )
    })
  })

  it("switches to approval rules management through the provided callback", async () => {
    const onManageApprovalRules = jest.fn()

    render(
      <AgentSettingsCard
        isTauriRuntime
        onManageApprovalRules={onManageApprovalRules}
      />
    )

    fireEvent.click(
      await screen.findByRole("button", { name: "agent.manageApprovalRules" })
    )

    expect(onManageApprovalRules).toHaveBeenCalledTimes(1)
  })
})
