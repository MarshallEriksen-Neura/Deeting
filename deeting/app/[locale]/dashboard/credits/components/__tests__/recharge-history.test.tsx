import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { RechargeHistory } from "@/app/[locale]/dashboard/credits/components/recharge-history"
import { exportCreditsRechargeOrdersCsv } from "@/lib/api/credits"
import { useCreditsRechargeOrders } from "@/lib/swr/use-credits-recharge-orders"

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}))

jest.mock("@/lib/swr/use-credits-recharge-orders", () => ({
  useCreditsRechargeOrders: jest.fn(),
}))

jest.mock("@/lib/api/credits", () => ({
  exportCreditsRechargeOrdersCsv: jest.fn(),
}))

const mockUseCreditsRechargeOrders = jest.mocked(useCreditsRechargeOrders)
const mockExportCreditsRechargeOrdersCsv = jest.mocked(exportCreditsRechargeOrdersCsv)

beforeEach(() => {
  jest.clearAllMocks()
})

afterEach(() => {
  jest.useRealTimers()
})

function makeOrder(overrides: Partial<{
  id: string
  outTradeNo: string
  tradeNo: string | null
  status: "success" | "pending" | "failed"
  tradeStatus: string | null
  amount: number
  currency: string
  expectedCreditedAmount: number
  creditedAmount: number
  channel: string
  errorCode: string | null
  errorDetail: string | null
  failureReason: string | null
  createdAt: string
  settledAt: string | null
}> = {}) {
  return {
    id: "order-1",
    outTradeNo: "alipay-user-success",
    tradeNo: "202603080001",
    status: "success" as const,
    tradeStatus: "TRADE_SUCCESS",
    amount: 3,
    currency: "CNY",
    expectedCreditedAmount: 60,
    creditedAmount: 60,
    channel: "alipay",
    errorCode: null,
    errorDetail: null,
    failureReason: null,
    createdAt: "2026-03-08T10:00:00Z",
    settledAt: "2026-03-08T10:01:00Z",
    ...overrides,
  }
}

describe("RechargeHistory", () => {
  const getRenderedOrderNos = () =>
    screen.getAllByTestId("recharge-order-number").map((element) => element.textContent)

  it("renders recharge orders with status and credited amount", () => {
    mockUseCreditsRechargeOrders.mockReturnValue({
      data: {
        items: [makeOrder()],
        nextOffset: null,
      },
      error: undefined,
      isLoading: false,
      mutate: jest.fn(),
    })

    render(<RechargeHistory />)

    expect(screen.getByText("rechargeHistory.title")).toBeInTheDocument()
    expect(screen.getByText("alipay-user-success")).toBeInTheDocument()
    expect(screen.getByText("60.00")).toBeInTheDocument()
    expect(screen.getByText("SUCCESS")).toHaveClass("bg-emerald-500/10")
    expect(screen.getByText("rechargeHistory.labels.tradeNo: 202603080001")).toBeInTheDocument()
    expect(screen.getByText("rechargeHistory.labels.channel: ALIPAY")).toBeInTheDocument()
    expect(screen.getByText(/rechargeHistory.labels.settledAt:/)).toBeInTheDocument()
  })

  it("renders an empty state when there are no recharge orders", () => {
    mockUseCreditsRechargeOrders.mockReturnValue({
      data: { items: [], nextOffset: null },
      error: undefined,
      isLoading: false,
      mutate: jest.fn(),
    })

    render(<RechargeHistory />)

    expect(screen.getByText("rechargeHistory.empty")).toBeInTheDocument()
  })

  it("filters recharge orders by selected status", () => {
    mockUseCreditsRechargeOrders.mockImplementation((params?: { status?: string | null }) => {
      const items = [
        makeOrder({ id: "order-success", outTradeNo: "order-success" }),
        makeOrder({
          id: "order-pending",
          outTradeNo: "order-pending",
          tradeNo: null,
          status: "pending",
          tradeStatus: "WAIT_BUYER_PAY",
          amount: 5,
          expectedCreditedAmount: 100,
          creditedAmount: 0,
          createdAt: "2026-03-08T11:00:00Z",
          settledAt: null,
        }),
      ]
      return {
        data: {
          items: params?.status ? items.filter((item) => item.status === params.status) : items,
          nextOffset: null,
        },
        error: undefined,
        isLoading: false,
        mutate: jest.fn(),
      }
    })

    render(<RechargeHistory />)

    fireEvent.click(screen.getByRole("button", { name: "rechargeHistory.filters.pending" }))

    expect(screen.getByText("order-pending")).toBeInTheDocument()
    expect(screen.queryByText("order-success")).not.toBeInTheDocument()
  })

  it("passes search and server-side sort params to the recharge hook", async () => {
    jest.useFakeTimers()
    mockUseCreditsRechargeOrders.mockReturnValue({
      data: { items: [makeOrder()], nextOffset: null },
      error: undefined,
      isLoading: false,
      mutate: jest.fn(),
    })

    render(<RechargeHistory />)

    fireEvent.change(screen.getByPlaceholderText("rechargeHistory.searchPlaceholder"), {
      target: { value: "trade-001" },
    })
    fireEvent.click(screen.getByRole("button", { name: "rechargeHistory.sorts.amount" }))

    expect(mockUseCreditsRechargeOrders).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: null,
        sortBy: "amount",
        sortDirection: "desc",
      })
    )

    act(() => {
      jest.advanceTimersByTime(300)
    })

    await waitFor(() =>
      expect(mockUseCreditsRechargeOrders).toHaveBeenLastCalledWith(
        expect.objectContaining({
          query: "trade-001",
          sortBy: "amount",
          sortDirection: "desc",
        })
      )
    )
  })

  it("supports date filtering and loading more rows", () => {
    const items = [
      ...Array.from({ length: 10 }, (_, index) =>
        makeOrder({
          id: `recent-${index + 1}`,
          outTradeNo: `recent-${index + 1}`,
          createdAt: `2026-03-${String(index + 1).padStart(2, "0")}T10:00:00Z`,
        })
      ),
      makeOrder({
        id: "older-1",
        outTradeNo: "older-1",
        createdAt: "2026-02-20T10:00:00Z",
      }),
      makeOrder({
        id: "older-2",
        outTradeNo: "older-2",
        createdAt: "2026-02-18T10:00:00Z",
      }),
    ]

    mockUseCreditsRechargeOrders.mockImplementation(
      (params?: { limit?: number; startDate?: string | null; endDate?: string | null }) => {
        let filtered = items
        if (params?.startDate) {
          filtered = filtered.filter((item) => item.createdAt.slice(0, 10) >= params.startDate!)
        }
        if (params?.endDate) {
          filtered = filtered.filter((item) => item.createdAt.slice(0, 10) <= params.endDate!)
        }
        const limit = params?.limit ?? 10
        return {
          data: {
            items: filtered.slice(0, limit),
            nextOffset: filtered.length > limit ? limit : null,
          },
          error: undefined,
          isLoading: false,
          mutate: jest.fn(),
        }
      }
    )

    render(<RechargeHistory />)

    expect(screen.getByText("recent-10")).toBeInTheDocument()
    expect(screen.queryByText("older-1")).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText("rechargeHistory.filters.startDate"), {
      target: { value: "2026-03-05" },
    })
    fireEvent.change(screen.getByLabelText("rechargeHistory.filters.endDate"), {
      target: { value: "2026-03-10" },
    })

    expect(screen.getByText("recent-5")).toBeInTheDocument()
    expect(screen.queryByText("recent-4")).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText("rechargeHistory.filters.startDate"), {
      target: { value: "2026-02-01" },
    })
    fireEvent.change(screen.getByLabelText("rechargeHistory.filters.endDate"), {
      target: { value: "2026-03-31" },
    })

    fireEvent.click(screen.getByRole("button", { name: "rechargeHistory.loadMore" }))

    expect(screen.getByText("older-1")).toBeInTheDocument()
    expect(screen.getByText("older-2")).toBeInTheDocument()
  })

  it("exports filtered recharge history as csv", async () => {
    const click = jest.fn()
    const anchor = { click, href: "", download: "" } as unknown as HTMLAnchorElement
    const originalCreateElement = document.createElement.bind(document)
    const createElementSpy = jest.spyOn(document, "createElement").mockImplementation((tagName) => {
      if (tagName === "a") {
        return anchor
      }
      return originalCreateElement(tagName)
    })
    const createObjectURL = jest.fn(() => "blob:recharge-history")
    const revokeObjectURL = jest.fn()
    Object.assign(global.URL, { createObjectURL, revokeObjectURL })

    mockUseCreditsRechargeOrders.mockReturnValue({
      data: { items: [makeOrder()], nextOffset: 10 },
      error: undefined,
      isLoading: false,
      mutate: jest.fn(),
    })
    mockExportCreditsRechargeOrdersCsv.mockResolvedValue(new Blob(["csv-data"], { type: "text/csv" }))

    render(<RechargeHistory />)

    fireEvent.click(screen.getByRole("button", { name: "rechargeHistory.filters.pending" }))
    fireEvent.change(screen.getByLabelText("rechargeHistory.filters.startDate"), {
      target: { value: "2026-03-01" },
    })
    fireEvent.change(screen.getByLabelText("rechargeHistory.filters.endDate"), {
      target: { value: "2026-03-10" },
    })

    fireEvent.click(screen.getByRole("button", { name: "rechargeHistory.exportCSV" }))

    await waitFor(() => expect(mockExportCreditsRechargeOrdersCsv).toHaveBeenCalledTimes(1))
    expect(mockExportCreditsRechargeOrdersCsv).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "pending",
        startDate: "2026-03-01",
        endDate: "2026-03-10",
      })
    )
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(click).toHaveBeenCalledTimes(1)
    expect(anchor.download).toBe("recharge-orders-pending-2026-03-01-to-2026-03-10.csv")

    createElementSpy.mockRestore()
  })

  it("applies quick date presets", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-03-15T12:00:00Z"))
    mockUseCreditsRechargeOrders.mockReturnValue({
      data: { items: [makeOrder()], nextOffset: null },
      error: undefined,
      isLoading: false,
      mutate: jest.fn(),
    })

    render(<RechargeHistory />)

    fireEvent.click(screen.getByRole("button", { name: "rechargeHistory.presets.last7Days" }))

    await waitFor(() =>
      expect(mockUseCreditsRechargeOrders).toHaveBeenLastCalledWith(
        expect.objectContaining({
          startDate: "2026-03-09",
          endDate: "2026-03-15",
        })
      )
    )
  })

  it("sorts rendered rows by amount", () => {
    mockUseCreditsRechargeOrders.mockReturnValue({
      data: {
        items: [
          makeOrder({ id: "small", outTradeNo: "small", amount: 2, createdAt: "2026-03-10T10:00:00Z" }),
          makeOrder({ id: "large", outTradeNo: "large", amount: 9, createdAt: "2026-03-09T10:00:00Z" }),
        ],
        nextOffset: null,
      },
      error: undefined,
      isLoading: false,
      mutate: jest.fn(),
    })

    render(<RechargeHistory />)

    expect(getRenderedOrderNos()).toEqual(["small", "large"])

    fireEvent.click(screen.getByRole("button", { name: "rechargeHistory.sorts.amount" }))

    expect(getRenderedOrderNos()).toEqual(["large", "small"])
  })

  it("opens an order detail dialog", async () => {
    mockUseCreditsRechargeOrders.mockReturnValue({
      data: { items: [makeOrder()], nextOffset: null },
      error: undefined,
      isLoading: false,
      mutate: jest.fn(),
    })

    render(<RechargeHistory />)

    fireEvent.click(screen.getByRole("button", { name: "rechargeHistory.actions.viewDetails" }))

    expect(await screen.findByText("rechargeHistory.detail.title")).toBeInTheDocument()
    expect(screen.getByText("rechargeHistory.detail.fields.tradeStatus")).toBeInTheDocument()
    expect(screen.getByText("TRADE_SUCCESS")).toBeInTheDocument()
  })

  it("copies order and trade numbers from details", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    mockUseCreditsRechargeOrders.mockReturnValue({
      data: { items: [makeOrder()], nextOffset: null },
      error: undefined,
      isLoading: false,
      mutate: jest.fn(),
    })

    render(<RechargeHistory />)

    fireEvent.click(screen.getByRole("button", { name: "rechargeHistory.actions.viewDetails" }))
    expect(await screen.findByText("rechargeHistory.detail.title")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "rechargeHistory.actions.copyOrder" }))
    fireEvent.click(screen.getByRole("button", { name: "rechargeHistory.actions.copyTradeNo" }))

    expect(writeText).toHaveBeenNthCalledWith(1, "alipay-user-success")
    expect(writeText).toHaveBeenNthCalledWith(2, "202603080001")
  })

  it("uses stacked responsive rows for mobile layouts", () => {
    mockUseCreditsRechargeOrders.mockReturnValue({
      data: { items: [makeOrder()], nextOffset: null },
      error: undefined,
      isLoading: false,
      mutate: jest.fn(),
    })

    render(<RechargeHistory />)

    expect(screen.getByTestId("recharge-order-row")).toHaveClass("block")
    expect(screen.getByText("rechargeHistory.time")).toBeInTheDocument()
  })

  it("shows failure reason for failed orders and exports a receipt from details", async () => {
    const click = jest.fn()
    const anchor = { click, href: "", download: "" } as unknown as HTMLAnchorElement
    const originalCreateElement = document.createElement.bind(document)
    const createElementSpy = jest.spyOn(document, "createElement").mockImplementation((tagName) => {
      if (tagName === "a") return anchor
      return originalCreateElement(tagName)
    })
    const createObjectURL = jest.fn(() => "blob:receipt")
    const revokeObjectURL = jest.fn()
    Object.assign(global.URL, { createObjectURL, revokeObjectURL })

    mockUseCreditsRechargeOrders.mockReturnValue({
      data: {
        items: [
          makeOrder({
            status: "failed",
            outTradeNo: "receipt-failed",
            tradeNo: "trade-failed-001",
            errorCode: "ACQ.TRADE_NOT_EXIST",
            errorDetail: "Buyer closed the order before payment.",
            failureReason: "Buyer closed the order before payment.",
          }),
        ],
        nextOffset: null,
      },
      error: undefined,
      isLoading: false,
      mutate: jest.fn(),
    })

    render(<RechargeHistory />)

    expect(screen.getByText("Buyer closed the order before payment.")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "rechargeHistory.actions.viewDetails" }))
    expect(await screen.findByText("rechargeHistory.detail.fields.failureReason")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "rechargeHistory.actions.exportReceipt" }))

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(click).toHaveBeenCalledTimes(1)
    expect(anchor.download).toBe("recharge-receipt-receipt-failed.txt")

    createElementSpy.mockRestore()
  })
})