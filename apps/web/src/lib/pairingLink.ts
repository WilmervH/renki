/**
 * Zero-typing connection for a browser. Two halves:
 *
 *  - Same-origin daemon: when the web app is served by its own nginx with a
 *    daemon upstream configured (the Kubernetes deployment, see
 *    deploy/helm/renki), `/api/*` on this origin is proxied to the daemon —
 *    REST and the WebSocket alike. Setup probes for that and pre-fills the URL.
 *
 *  - Pairing link: `https://<web>/#token=…[&url=…]`. The token rides in the
 *    fragment, which browsers never send to the server, so it can't end up in
 *    nginx or Ingress access logs. It's read once on load, saved like a typed
 *    token would be, and scrubbed from the address bar. `url` is only present
 *    when the daemon isn't this origin's `/api`.
 *
 * Same access model as typing it in: the browser holds the token and sends it
 * on every request; the proxy in between holds no secret of its own.
 */
import { addHost, setActiveHost, updateHost, type HostsState, type PairingPayload } from "@renki/client-core";
import { useEffect, useState } from "react";

const API_PREFIX = "/api";
const HEALTH_TIMEOUT_MS = 3000;

export function sameOriginApiBase(origin: string): string {
  return `${origin}${API_PREFIX}`;
}

/** Only http(s) — a crafted link must not be able to point the client at another scheme. */
function normalizeHttpUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    // Request paths are appended to the base, so anything after the path
    // would end up in the wrong place; credentials don't belong in a link.
    return `${url.origin}${url.pathname}`.replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function parsePairingFragment(hash: string, origin: string): PairingPayload | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const token = params.get("token");
  if (!token) return null;
  const rawUrl = params.get("url");
  if (rawUrl === null) return { baseUrl: sameOriginApiBase(origin), token };
  const baseUrl = normalizeHttpUrl(rawUrl);
  return baseUrl ? { baseUrl, token } : null;
}

/** True when `baseUrl` is served from `origin` itself — i.e. not a server the link chose. */
export function isSameOrigin(baseUrl: string, origin: string): boolean {
  try {
    return new URL(baseUrl).origin === origin;
  } catch {
    return false;
  }
}

export function buildPairingLink(webOrigin: string, baseUrl: string, token: string): string {
  const params = new URLSearchParams({ token });
  if (baseUrl.replace(/\/$/, "") !== sameOriginApiBase(webOrigin)) params.set("url", baseUrl);
  return `${webOrigin}/#${params.toString()}`;
}

/**
 * Reads a pairing link off the current URL and removes it from the address
 * bar (replaceState, so the token-bearing entry doesn't stay in this tab's
 * back/forward history either). An unrelated fragment is left untouched.
 */
export function consumePairingFragment(): PairingPayload | null {
  const payload = parsePairingFragment(window.location.hash, window.location.origin);
  if (!payload) return null;
  const { pathname, search } = window.location;
  window.history.replaceState(window.history.state, "", `${pathname}${search}`);
  return payload;
}

/**
 * The pairing link currently pending, consumed on first render — and again
 * whenever one is pasted into a tab that already has the app open, since a
 * fragment-only change doesn't reload the page. The setter dismisses it.
 */
export function usePairingFragment(): [PairingPayload | null, (next: PairingPayload | null) => void] {
  const [pairing, setPairing] = useState(consumePairingFragment);
  useEffect(() => {
    const onHashChange = () => {
      const next = consumePairingFragment();
      if (next) setPairing(next);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  return [pairing, setPairing];
}

const stripSlash = (url: string): string => url.replace(/\/$/, "");

/** A short default label for the host switcher when none was typed: the daemon's hostname. */
function defaultLabel(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return "Home";
  }
}

/**
 * Saves a paired connection into the host list. A daemon already in the list
 * (same URL) gets its token refreshed and becomes active — re-following a link
 * after the cluster's token was rotated shouldn't leave a stale duplicate.
 */
export function applyPairing(
  state: HostsState,
  payload: PairingPayload,
  opts: { deviceName: string; label: string },
): HostsState {
  const baseUrl = stripSlash(payload.baseUrl);
  const existing = state.hosts.find((h) => stripSlash(h.baseUrl) === baseUrl);
  if (existing) {
    const patch = { token: payload.token, deviceName: opts.deviceName, ...(opts.label ? { label: opts.label } : {}) };
    return setActiveHost(updateHost(state, existing.id, patch), existing.id);
  }
  return addHost(state, {
    label: opts.label || defaultLabel(baseUrl),
    baseUrl,
    token: payload.token,
    deviceName: opts.deviceName,
  });
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * True when `<origin>/api/health` answers like the daemon does. A plain static
 * deployment answers that path with the SPA's index.html (a 200, but not
 * `{ ok: true }`), so the body is checked, not just the status.
 */
export async function detectSameOriginDaemon(origin: string, fetchFn: FetchFn = fetch): Promise<boolean> {
  try {
    const res = await fetchFn(`${sameOriginApiBase(origin)}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const body: unknown = await res.json();
    return typeof body === "object" && body !== null && (body as { ok?: unknown }).ok === true;
  } catch {
    return false;
  }
}
