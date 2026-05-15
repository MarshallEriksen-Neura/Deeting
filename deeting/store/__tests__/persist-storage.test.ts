describe("persisted store hydration with corrupt JSON", () => {
  beforeEach(() => {
    jest.resetModules();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("drops a corrupt auth session payload instead of throwing during hydration", () => {
    sessionStorage.setItem("deeting-auth-store", "");

    expect(() => {
      jest.isolateModules(() => {
        const { useAuthStore } = jest.requireActual("../auth-store") as typeof import("../auth-store");

        expect(useAuthStore.getState().isAuthenticated).toBe(false);
        expect(useAuthStore.getState().accessToken).toBeNull();
      });
    }).not.toThrow();

    expect(sessionStorage.getItem("deeting-auth-store")).toBeNull();
  });

  it("drops a corrupt language payload instead of throwing during hydration", () => {
    localStorage.setItem("deeting-language-store", "{");

    expect(() => {
      jest.isolateModules(() => {
        const { useLanguageStore } = jest.requireActual("../language-store") as typeof import("../language-store");

        expect(useLanguageStore.getState().language).toBeNull();
      });
    }).not.toThrow();

    const persisted = localStorage.getItem("deeting-language-store");
    expect(persisted).not.toBeNull();
    expect(() => JSON.parse(persisted as string)).not.toThrow();
  });
});
