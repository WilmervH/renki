import { flushSync } from "react-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostsState } from "@renki/client-core";
import {
  applyPairing,
  buildPairingLink,
  consumePairingFragment,
  detectSameOriginDaemon,
  parsePairingFragment,
  sameOriginApiBase,
  usePairingFragment,
} from "../src/lib/pairingLink.js";
import { cleanupRoots, render } from "./render.js";

/**
 * A pairing link carries the token in the URL fragment, which browsers never
 * send to the server — so it can't land in nginx or Ingress access logs. When
 * the web app is served behind the in-cluster proxy, the daemon lives at
 * <origin>/api and the link needs nothing but the token.
 */
const ORIGIN = "https://renki.example.com";

describe("sameOriginApiBase", () => {
  it("points at the /api prefix the web nginx proxies to the daemon", () => {
    expect(sameOriginApiBase(ORIGIN)).toBe("https://renki.example.com/api");
  });
});

describe("parsePairingFragment", () => {
  it("defaults the daemon URL to this origin's /api when only a token is given", () => {
    expect(parsePairingFragment("#token=abc123", ORIGIN)).toEqual({
      baseUrl: "https://renki.example.com/api",
      token: "abc123",
    });
  });

  it("uses an explicit url param, without a trailing slash", () => {
    const hash = `#token=abc&url=${encodeURIComponent("http://homelab.tailnet:4517/")}`;
    expect(parsePairingFragment(hash, ORIGIN)).toEqual({ baseUrl: "http://homelab.tailnet:4517", token: "abc" });
  });

  it("returns null when there is no token", () => {
    expect(parsePairingFragment("", ORIGIN)).toBeNull();
    expect(parsePairingFragment("#", ORIGIN)).toBeNull();
    expect(parsePairingFragment("#token=", ORIGIN)).toBeNull();
    expect(parsePairingFragment("#something-else", ORIGIN)).toBeNull();
  });

  it("rejects a url that isn't http(s), so a crafted link can't smuggle in another scheme", () => {
    const hash = `#token=abc&url=${encodeURIComponent("javascript:alert(1)")}`;
    expect(parsePairingFragment(hash, ORIGIN)).toBeNull();
  });

  it("drops credentials, query and hash from the url, which would break every request path", () => {
    const hash = `#token=abc&url=${encodeURIComponent("https://u:p@h.example:4517/x?y=1#z")}`;
    expect(parsePairingFragment(hash, ORIGIN)).toEqual({ baseUrl: "https://h.example:4517/x", token: "abc" });
  });

  it("rejects a url that doesn't parse", () => {
    expect(parsePairingFragment("#token=abc&url=not%20a%20url", ORIGIN)).toBeNull();
  });
});

describe("buildPairingLink", () => {
  it("omits the url when the daemon is this origin's /api", () => {
    expect(buildPairingLink(ORIGIN, `${ORIGIN}/api`, "abc")).toBe("https://renki.example.com/#token=abc");
  });

  it("includes the url otherwise, and round-trips through parsePairingFragment", () => {
    const link = buildPairingLink(ORIGIN, "http://homelab.tailnet:4517", "a+b/c=");
    const hash = new URL(link).hash;
    expect(parsePairingFragment(hash, ORIGIN)).toEqual({ baseUrl: "http://homelab.tailnet:4517", token: "a+b/c=" });
  });
});

describe("consumePairingFragment", () => {
  it("returns the payload and scrubs the fragment from the address bar", () => {
    window.history.replaceState(null, "", "/session/x?q=1#token=secret");
    const payload = consumePairingFragment();
    expect(payload?.token).toBe("secret");
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/session/x");
    expect(window.location.search).toBe("?q=1");
  });

  it("leaves an unrelated fragment alone", () => {
    window.history.replaceState(null, "", "/#section-2");
    expect(consumePairingFragment()).toBeNull();
    expect(window.location.hash).toBe("#section-2");
  });
});

describe("detectSameOriginDaemon", () => {
  it("is true when <origin>/api/health answers like the daemon", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await expect(detectSameOriginDaemon(ORIGIN, fetchFn)).resolves.toBe(true);
    expect(fetchFn).toHaveBeenCalledWith("https://renki.example.com/api/health", expect.anything());
  });

  it("is false when the SPA fallback answers with index.html instead", async () => {
    const fetchFn = vi.fn(async () => new Response("<!doctype html><html></html>", { status: 200 }));
    await expect(detectSameOriginDaemon(ORIGIN, fetchFn)).resolves.toBe(false);
  });

  it("is false on a 404 or a network error", async () => {
    await expect(detectSameOriginDaemon(ORIGIN, async () => new Response("", { status: 404 }))).resolves.toBe(false);
    await expect(
      detectSameOriginDaemon(ORIGIN, async () => {
        throw new TypeError("Failed to fetch");
      }),
    ).resolves.toBe(false);
  });
});

describe("applyPairing", () => {
  const home = { id: "h1", label: "Home", baseUrl: "https://renki.example.com/api", token: "old", deviceName: "Web" };
  const mac = { id: "h2", label: "Mac", baseUrl: "http://mac.tailnet:4517", token: "m", deviceName: "Web" };

  it("adds a new host and makes it active", () => {
    const state: HostsState = { hosts: [mac], activeId: "h2" };
    const next = applyPairing(state, { baseUrl: home.baseUrl, token: "t" }, { deviceName: "Laptop", label: "" });
    expect(next.hosts).toHaveLength(2);
    const added = next.hosts.find((h) => h.baseUrl === home.baseUrl)!;
    expect(added).toMatchObject({ token: "t", deviceName: "Laptop", label: "renki.example.com" });
    expect(next.activeId).toBe(added.id);
  });

  it("re-pairing a known host (e.g. a rotated token) updates it instead of duplicating it", () => {
    const state: HostsState = { hosts: [home, mac], activeId: "h2" };
    const next = applyPairing(state, { baseUrl: `${home.baseUrl}/`, token: "new" }, { deviceName: "Web", label: "" });
    expect(next.hosts).toHaveLength(2);
    expect(next.hosts.find((h) => h.id === "h1")).toMatchObject({ token: "new", label: "Home" });
    expect(next.activeId).toBe("h1");
    expect(state.hosts[0]!.token).toBe("old"); // input untouched
  });
});

describe("usePairingFragment", () => {
  afterEach(cleanupRoots);

  function Probe() {
    const [pairing] = usePairingFragment();
    return <p data-testid="probe">{pairing ? pairing.token : "none"}</p>;
  }

  /** Pasting a link into a tab that already has the app open only changes the fragment — no reload. */
  it("picks up a link pasted into an already-open tab", () => {
    window.history.replaceState(null, "", "/");
    render(<Probe />);
    expect(document.querySelector("[data-testid=probe]")!.textContent).toBe("none");

    window.history.replaceState(null, "", "/#token=later");
    flushSync(() => window.dispatchEvent(new HashChangeEvent("hashchange")));

    expect(document.querySelector("[data-testid=probe]")!.textContent).toBe("later");
    expect(window.location.hash).toBe("");
  });
});
