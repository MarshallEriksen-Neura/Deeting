import {
  buildExternalLoginHostUrl,
  buildLoginHostRoute,
  isLoginHostRoute,
  normalizeAuthCallbackUrl,
} from "../world-model";

describe("auth world model helpers", () => {
  it("builds the default login host route without a callback", () => {
    expect(buildLoginHostRoute()).toBe("/login");
  });

  it("preserves a safe relative callback when building the login host route", () => {
    expect(buildLoginHostRoute("/chat?agentId=agent-1")).toBe(
      "/login?callbackUrl=%2Fchat%3FagentId%3Dagent-1"
    );
  });

  it("rejects absolute callback urls and login loops", () => {
    expect(normalizeAuthCallbackUrl("https://example.com/phish", "/chat")).toBe("/chat");
    expect(normalizeAuthCallbackUrl("/login?callbackUrl=%2Fchat", "/chat")).toBe("/chat");
    expect(normalizeAuthCallbackUrl("/en/login", "/chat")).toBe("/chat");
  });

  it("detects login host routes with locale prefixes", () => {
    expect(isLoginHostRoute("/login")).toBe(true);
    expect(isLoginHostRoute("/en/login?callbackUrl=%2Fchat")).toBe(true);
    expect(isLoginHostRoute("/chat")).toBe(false);
  });

  it("builds an external login host url while preserving existing query params", () => {
    expect(
      buildExternalLoginHostUrl({
        baseUrl: "https://app.example.com/login?source=desktop",
        callbackUrl: "/en/chat?session=1",
      })
    ).toBe(
      "https://app.example.com/login?source=desktop&callbackUrl=%2Fen%2Fchat%3Fsession%3D1"
    );
  });

  it("supports relative external login routes when an origin is supplied", () => {
    expect(
      buildExternalLoginHostUrl({
        baseUrl: "/login",
        callbackUrl: "/chat",
        origin: "http://localhost:3000",
      })
    ).toBe("http://localhost:3000/login?callbackUrl=%2Fchat");
  });
});
