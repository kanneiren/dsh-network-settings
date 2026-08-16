# Contributing

Thanks for helping improve `dsh-network-settings`.

## Project layout

- `src/host` — Network Core and the DSH host half (read-only inspection,
  diagnostics, scoped configuration, snapshots/repair, advanced first aid).
- `src/client` — Settings UI (Settings → Plugins → Network). Components never
  execute platform commands; everything goes through the typed RPC service.
- `tests/unit` — parser, diagnosis, snapshot and redaction tests.
- `tests/ui` — React component tests and CSS token guard tests.
- `tests/e2e` — Playwright smoke against a running DSH web profile.

## Development

Requirements: Node.js >= 22.19, npm (pnpm for DSH profile installation).

```bash
npm install
npm run typecheck
npm test
npm run test:ui
npm run build
```

Windows/WSL smoke (read-only):

```powershell
node --experimental-strip-types src/host/smoke.ts --no-probes --no-wsl
```

## Testing against a real DSH

Use an isolated profile so your normal `web` profile is untouched:

```powershell
# copy the web profile manually, or let `dsh plugin` initialize one
dsh plugin --profile networktest add C:\path\to\dsh-network-settings
dsh --profile networktest --port 3091
# from the checkout:
DSH_URL=http://127.0.0.1:3091 node tests/e2e/smoke.mjs
```

The plugin is read-only unless you explicitly confirm a configuration change,
a repair, or an advanced reset.

## Style

- UI copy must be localized through `src/client/locales.ts` (zh + en).
- Client CSS must consume `--dsw-alias-*` tokens only: no literal colors, no
  global selectors, no dark-theme selectors.
- Network Core stays deterministic: no LLM in any diagnostic path.
- Every scoped write creates a redacted snapshot before touching the system.
