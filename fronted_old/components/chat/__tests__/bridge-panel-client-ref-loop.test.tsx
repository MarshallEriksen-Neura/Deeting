import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import { BridgePanelClient } from "../bridge-panel-client";
import { useChatStore } from "@/lib/stores/chat-store";

vi.mock("@/lib/i18n-context", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    language: "zh",
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/lib/swr/use-bridge", () => ({
  useBridgeAgents: () => ({ agents: [], error: null, loading: false, refresh: vi.fn() }),
  useBridgeTools: () => ({ tools: [], error: null, loading: false, refresh: vi.fn() }),
  useBridgeInvoke: () => ({ trigger: vi.fn() }),
  useBridgeCancel: () => ({ trigger: vi.fn() }),
}));

vi.mock("@/lib/hooks/use-bridge-events", () => ({
  useBridgeEvents: () => ({
    connected: false,
    error: null,
    events: [],
    connect: vi.fn(),
    disconnect: vi.fn(),
    clear: vi.fn(),
  }),
}));

describe("BridgePanelClient", () => {
  beforeEach(() => {
    useChatStore.getState().reset();
  });

  it("不应触发 Maximum update depth exceeded", () => {
    expect(() => {
      render(<BridgePanelClient conversationId="conv-1" />);
    }).not.toThrow();
  });
});

