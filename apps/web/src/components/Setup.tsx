import { describeConnectionError, type PairingPayload } from "@renki/client-core";
import { useEffect, useRef, useState } from "react";
import { type AppConfig, getOrCreateDeviceId } from "../lib/config.js";
import { detectSameOriginDaemon, isSameOrigin, sameOriginApiBase } from "../lib/pairingLink.js";
import { Button } from "./ui.js";

const LOOPBACK_DEFAULT = "http://127.0.0.1:4517";

/**
 * Point a client at a daemon and enter its token — used both for first-run
 * onboarding (full screen, no way to cancel: there's nothing to go back to
 * yet) and for adding a second host to switch between (a modal, with Cancel).
 *
 * `label` is the second thing add-host mode collects beyond `AppConfig`: it's
 * what this host is called in the switcher ("Mac", "Homelab"), which is a
 * different question from `deviceName` (what THIS device calls itself to
 * THAT daemon's other clients). Onboarding doesn't ask for it — with only one
 * host there's nothing to distinguish yet — so callers in that mode can
 * ignore the second argument.
 *
 * Two ways it fills itself in (see lib/pairingLink.ts): `initial` from a
 * pairing link is tested straight away when it points at this site's own
 * daemon — one naming another server waits for an explicit Connect, since a
 * crafted link could otherwise point a browser at someone else's daemon
 * and send it this user's prompts and code. Otherwise it probes this page's own
 * origin, and if the daemon answers at `/api` (the Kubernetes deployment's
 * web nginx proxies it there) uses that, leaving only the token to paste.
 */
export function Setup({
  onSave,
  onCancel,
  mode = "onboarding",
  initial,
}: {
  onSave: (config: AppConfig, label: string) => void;
  onCancel?: () => void;
  mode?: "onboarding" | "add-host";
  initial?: PairingPayload;
}) {
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? LOOPBACK_DEFAULT);
  const [token, setToken] = useState(initial?.token ?? "");
  const foreignLink = initial !== undefined && !isSameOrigin(initial.baseUrl, window.location.origin);
  const [sameOrigin, setSameOrigin] = useState(initial !== undefined && !foreignLink);
  // The probe below must never overwrite a URL the user has started typing.
  const urlEdited = useRef(false);
  const [showToken, setShowToken] = useState(false);
  const [deviceName, setDeviceName] = useState("Web");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [found, setFound] = useState<{ repos: number; root: string } | null>(null);
  const adding = mode === "add-host";

  useEffect(() => {
    if (initial) {
      if (!foreignLink) void testConnection(initial.baseUrl, initial.token);
      return;
    }
    let cancelled = false;
    const origin = window.location.origin;
    void detectSameOriginDaemon(origin).then((found) => {
      if (!found || cancelled || urlEdited.current) return;
      setBaseUrl(sameOriginApiBase(origin));
      setSameOrigin(true);
    });
    return () => {
      cancelled = true;
    };
    // Once, on mount: `initial` is fixed for this screen's lifetime.
  }, []);

  async function testConnection(url: string, tok: string) {
    setError(null);
    setTesting(true);
    try {
      const res = await fetch(`${url.replace(/\/$/, "")}/repos`, {
        headers: { authorization: `Bearer ${tok}` },
      });
      if (res.status === 401) throw new Error("Token rejected (401).");
      if (!res.ok) throw new Error(`Daemon responded ${res.status}.`);
      const body = (await res.json()) as { repos: unknown[]; root: string };
      setFound({ repos: body.repos.length, root: body.root });
    } catch (e) {
      setError(describeConnectionError(e));
    } finally {
      setTesting(false);
    }
  }

  function submit() {
    void testConnection(baseUrl, token);
  }

  function continueSetup() {
    onSave({ baseUrl: baseUrl.replace(/\/$/, ""), token, deviceId: getOrCreateDeviceId(), deviceName }, label.trim());
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="renki-enter w-full max-w-sm space-y-5 rounded-2xl border border-(--renki-border) bg-(--renki-surface) p-7 shadow-(--renki-shadow-lg)">
        <div className="space-y-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-(--renki-accent) text-(--renki-accent-fg) shadow-(--renki-shadow-sm)">
            <span className="codicon codicon-terminal text-xl" />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-(--renki-fg)">
              {adding ? "Add another host" : "Connect to your daemon"}
            </h1>
            <p className="mt-1 text-sm text-(--renki-fg-muted)">
              {adding
                ? "Another daemon this device can switch to — your Mac, a second server. Uses the same take-control identity you already have."
                : sameOrigin
                  ? "This site already reaches your Renki daemon — just paste its token."
                  : "Point this browser at the Renki daemon on your homelab and paste its token."}
            </p>
          </div>
        </div>

        {foreignLink && (
          <p className="rounded-lg border border-(--renki-warning)/50 bg-(--renki-warning)/10 px-3 py-2 text-sm text-(--renki-warning)">
            This link connects to <code>{new URL(initial.baseUrl).host}</code>, not this site. Only continue if
            that's your own daemon — it will receive everything you send.
          </p>
        )}

        {adding && (
          <Field label="Name for this host (shown in the switcher)">
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Mac, Homelab" className="renki-input" />
          </Field>
        )}

        <Field label="Daemon URL">
          <input
            value={baseUrl}
            onChange={(e) => {
              urlEdited.current = true;
              setBaseUrl(e.target.value);
              setFound(null);
            }}
            placeholder="http://homelab.tailnet:4517"
            className="renki-input"
          />
        </Field>
        <Field label="Auth token">
          <div className="flex items-center gap-2">
            <input
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                setFound(null);
              }}
              type={showToken ? "text" : "password"}
              placeholder="RENKI_AUTH_TOKEN"
              className="renki-input min-w-0 flex-1"
            />
            <button
              type="button"
              onClick={() => setShowToken((v) => !v)}
              className="shrink-0 text-xs text-(--renki-fg-muted) hover:text-(--renki-fg)"
            >
              {showToken ? "Hide" : "Show"}
            </button>
          </div>
        </Field>
        <Field label="This device's name">
          <input value={deviceName} onChange={(e) => setDeviceName(e.target.value)} className="renki-input" />
        </Field>

        {error && <p className="rounded-lg border border-(--renki-danger)/30 bg-(--renki-danger)/10 px-3 py-2 text-sm text-(--renki-danger)">{error}</p>}

        {found && (
          <p className="rounded-lg border border-(--renki-success)/30 bg-(--renki-success)/10 px-3 py-2 text-sm text-(--renki-success)">
            Connected — found {found.repos} repo{found.repos === 1 ? "" : "s"} under{" "}
            <code className="text-(--renki-success)">{found.root}</code>.
            {found.repos === 0 && " Add a git repo there (or point RENKI_REPOS_ROOT elsewhere) before creating a session."}
          </p>
        )}

        <Button
          variant="primary"
          className="w-full"
          disabled={testing || !token}
          onClick={found ? continueSetup : submit}
        >
          {testing ? "Testing…" : found ? (adding ? "Add host" : "Continue") : "Connect"}
        </Button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="block w-full text-center text-xs text-(--renki-fg-muted) hover:text-(--renki-fg)"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-(--renki-fg-muted)">{label}</span>
      {children}
    </label>
  );
}
