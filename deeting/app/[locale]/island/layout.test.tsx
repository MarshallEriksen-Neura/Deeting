import React from "react";
import { render, screen } from "@testing-library/react";

import IslandLayout from "./layout";

const mockSetRequestLocale = jest.fn();
const mockDesktopRouteMessagesProvider = jest.fn(
  ({
    children,
  }: {
    children: React.ReactNode;
  }) => <div data-testid="desktop-route-messages-provider">{children}</div>,
);

jest.mock("next-intl/server", () => ({
  setRequestLocale: (locale: string) => mockSetRequestLocale(locale),
}));

jest.mock("@/components/common/desktop-route-messages-provider", () => ({
  DesktopRouteMessagesProvider: (props: {
    locale: string;
    namespaces: readonly string[];
    children: React.ReactNode;
  }) => mockDesktopRouteMessagesProvider(props),
}));

describe("IslandLayout", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("loads chat messages for the desktop island route", async () => {
    const tree = await IslandLayout({
      children: <div data-testid="child">Island content</div>,
      params: Promise.resolve({ locale: "zh-CN" }),
    });

    render(tree);

    expect(mockSetRequestLocale).toHaveBeenCalledWith("zh-CN");
    expect(mockDesktopRouteMessagesProvider).toHaveBeenCalledTimes(1);
    expect(mockDesktopRouteMessagesProvider.mock.calls[0][0]).toMatchObject({
      locale: "zh-CN",
      namespaces: ["common", "chat"],
    });
    expect(
      screen.getByTestId("desktop-route-messages-provider"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });
});
