import { screen } from "@testing-library/react";
import { flushSync } from "react-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { cleanupRoots, render } from "./render.js";

afterEach(() => {
  cleanupRoots();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("App pairing link", () => {
  /**
   * The first-run Setup is already on screen when the link is pasted in; the
   * pairing one must replace it, not inherit its state, or the link's token
   * is never tested or shown.
   */
  it("connects from a link pasted into the already-open first-run screen", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith("/repos")
          ? new Response(JSON.stringify({ repos: [{}], root: "/repos" }))
          : new Response("<!doctype html>"),
      ),
    );
    window.history.replaceState(null, "", "/");
    render(<App />);

    window.history.replaceState(null, "", "/#token=pasted");
    flushSync(() => window.dispatchEvent(new HashChangeEvent("hashchange")));

    expect(await screen.findByText(/found 1 repo/)).toBeInTheDocument();
  });
});
