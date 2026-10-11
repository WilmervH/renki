import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Setup } from "../src/components/Setup.js";
import { cleanupRoots, render } from "./render.js";

/**
 * Behind the Kubernetes web nginx, `/api` on the page's own origin is the
 * daemon — Setup should find that by itself so the only thing left to enter
 * is the token. Anywhere else (vite dev, the plain static image) nothing
 * answers there, and the old loopback default stays.
 */
type Route = (url: string) => Response | Promise<Response>;

function stubFetch(route: Route) {
  const fn = vi.fn(async (input: RequestInfo | URL) => route(String(input)));
  vi.stubGlobal("fetch", fn);
  return fn;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => {
  cleanupRoots();
  vi.unstubAllGlobals();
});

describe("Setup", () => {
  it("pre-fills this origin's /api when the daemon answers there", async () => {
    stubFetch((url) => (url.endsWith("/api/health") ? json({ ok: true }) : json({}, 404)));
    render(<Setup onSave={() => {}} />);
    expect(await screen.findByDisplayValue(`${window.location.origin}/api`)).toBeInTheDocument();
  });

  it("keeps the loopback default when nothing daemon-like answers on this origin", async () => {
    const fetchFn = stubFetch(() => new Response("<!doctype html>", { status: 200 }));
    render(<Setup onSave={() => {}} />);
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalled());
    expect(screen.getByDisplayValue("http://127.0.0.1:4517")).toBeInTheDocument();
  });

  it("tests a same-origin pairing link straight away, with nothing to type", async () => {
    const fetchFn = stubFetch((url) =>
      url.endsWith("/repos") ? json({ repos: [{}, {}], root: "/repos" }) : json({}, 404),
    );
    const baseUrl = `${window.location.origin}/api`;
    render(<Setup onSave={() => {}} initial={{ baseUrl, token: "paired" }} />);

    expect(await screen.findByText(/found 2 repos/)).toBeInTheDocument();
    expect(fetchFn).toHaveBeenCalledWith(
      `${baseUrl}/repos`,
      expect.objectContaining({ headers: { authorization: "Bearer paired" } }),
    );
    // A pairing link already names its daemon — no same-origin probe needed.
    expect(fetchFn).not.toHaveBeenCalledWith(expect.stringMatching(/\/api\/health$/), expect.anything());
  });

  /**
   * A link can name any daemon. Following one to a server the user didn't
   * choose would send their prompts and code there, so a link pointing off
   * this origin waits for an explicit Connect and says where it points.
   */
  it("doesn't contact a pairing link's other server until the user confirms", async () => {
    const fetchFn = stubFetch(() => json({}, 404));
    render(<Setup onSave={() => {}} initial={{ baseUrl: "https://elsewhere.example/api", token: "t" }} />);

    expect(screen.getByText(/elsewhere\.example/, { selector: "p *, p" })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchFn).not.toHaveBeenCalledWith(expect.stringContaining("elsewhere.example"), expect.anything());
  });
});
