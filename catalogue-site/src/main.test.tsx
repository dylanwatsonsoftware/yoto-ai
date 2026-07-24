import { beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.body.innerHTML = '<div id="root"></div>';
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
});

it("applies the default dark theme while the catalogue is loading", async () => {
  await import("./main");

  expect(document.documentElement).toHaveAttribute("data-theme", "dark");
});
