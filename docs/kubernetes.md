# Running Renki on Kubernetes

The Helm chart in [`deploy/helm/renki`](../deploy/helm/renki) runs the daemon and the web app in-cluster, on **one origin**:

```
browser ──► Ingress / port-forward ──► web (nginx)
                                        ├── /        static web app
                                        └── /api/*   ──► daemon Service :4517  (REST + WebSocket)
```

The web pod's nginx proxies `/api/*` to the daemon, so the browser never needs a daemon URL, CORS, or a second hostname. Setup checks `<origin>/api/health` and fills in the URL by itself, leaving only the token to enter.

**The browser holds the token.** It is entered once per browser, kept in that browser's storage, and sent with each request. The proxy only passes it through and holds no credentials of its own, so reaching the URL doesn't grant access by itself.

## Install

```bash
helm install renki deploy/helm/renki -n renki --create-namespace \
  --set-file claude.oauthToken=./claude-token.txt   # output of `claude setup-token`
```

The install notes print a **pairing link**: `https://<host>/#token=…`. Open it once in each browser. The token sits in the URL fragment, which browsers never send to the server, so opening the link doesn't log it anywhere. The app saves it and removes it from the address bar. Settings → Pair a device → **Copy browser pairing link** gives the same link to share with your other browsers.

### Values worth knowing

| Value | What it does |
| --- | --- |
| `claude.oauthToken` | `claude setup-token` output → `CLAUDE_CODE_OAUTH_TOKEN`. Without it, run `kubectl exec -it renki-daemon-0 -- claude login` once (persisted). |
| `auth.token` | Choose the client token yourself. Empty → the daemon mints one on first boot and keeps it on the `data` volume, so it survives upgrades, reinstalls and GitOps re-renders. Print it with `kubectl exec renki-daemon-0 -- node dist/cli.js token`. |
| `existingSecret` | Bring your own Secret with keys `authToken`, `claudeOauthToken`, `githubToken`. |
| `github.token` | `GH_TOKEN` for `gh`, which is also git's credential helper for github.com (private clones, pushes, PRs). |
| `git.userName` / `git.userEmail` | Commit identity for sessions. |
| `daemon.persistence.*` | PVCs for `data` (SQLite + worktrees), `repos` (`RENKI_REPOS_ROOT`) and `claude` (`~/.claude`, transcripts that resume depends on). |
| `daemon.env` | Any other `RENKI_*` setting from `.env.example`. |
| `ingress.*` | Generic `networking.k8s.io/v1` Ingress; one host, path `/`. Enable `tls` — the token is on every request. |

### Repos

`/repos` starts empty. Clone into it from the app's GitHub picker (with `github.token` set), or directly:

```bash
kubectl -n renki exec -it renki-daemon-0 -- git -C /repos clone https://github.com/you/project
```

## Notes

- **Access logs.** Browsers can't put headers on a WebSocket, so the daemon accepts the token as `?token=` there. That's true everywhere Renki runs, not just here. The web pod's nginx logs `/api/` requests without their query string. **Your Ingress controller logs whatever it's configured to**, which usually includes the query string. Either drop the query from its log format, or treat its logs as sensitive.
- **One daemon replica.** It owns a SQLite db and git worktrees on ReadWriteOnce volumes. The web Deployment can scale freely.
- **No controller-specific annotations needed.** The Ingress routes everything to the web Service, and the app pings its WebSocket every 15s, so default proxy timeouts never close it.
- **The plain `renki-web` image is unchanged** when `RENKI_DAEMON_UPSTREAM` is unset, so docker-compose and static setups behave as before. Set it (`host:port`) on any deployment of that image to turn on the same-origin proxy.
- **Run the cluster yourself?** Build the images locally instead of pulling from GHCR:

  ```bash
  eval $(minikube docker-env)
  docker build -t renki:dev . && docker build -f Dockerfile.web -t renki-web:dev .
  helm install renki deploy/helm/renki -n renki --create-namespace \
    --set image.daemon.repository=renki,image.daemon.tag=dev \
    --set image.web.repository=renki-web,image.web.tag=dev
  ```
