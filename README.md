# manychat-axi

Agent-ergonomic CLI for ManyChat. [AXI](https://axi.md)-compliant: TOON
output, pre-computed counts, structured errors, `--confirm` gates on
mutations, and `help[]` next steps on every result.

Phase 0 covers the **public API** surface - automation inventory, tags, and
fields. Phase 1 adds the **browser transport**: a persistent headed Chrome
profile for manual login, a live session probe, and a `discover` command
that records the Flow Builder's own document traffic. Flow content commands
(`flows get/pull/diff/push`, `template deploy`, publishing) are built from
discovery artifacts in Phase 2+; see [Roadmap](#roadmap).

## Install

```sh
npm install -g manychat-axi
# or run on demand, identical:
npx -y manychat-axi@latest flows list
```

## Auth

Generate an API key in ManyChat (**Settings → API**, paid plans) and export
it. The key lives in the environment (or a gitignored `.env` file in the
working directory — real env vars win) - never in flags or chat.

```sh
export MANYCHAT_API_KEY="..."
manychat-axi auth status
```

Optional: `MANYCHAT_API_URL` overrides `https://api.manychat.com` (HTTPS
only; useful for proxies and local mocks).

## Commands

| Command | Description |
| --- | --- |
| `manychat-axi` | Live home view: auth state, page, counts (zero calls without a key) |
| `manychat-axi auth status` | API key state; browser session state (`--browser` to probe live) |
| `manychat-axi auth login` | Open a visible Chrome window, wait for manual login |
| `manychat-axi auth logout` | Clear the session record (`--purge` deletes the profile) |
| `manychat-axi flows list` | Automation inventory (`ns`, `name`, `folder`) |
| `manychat-axi flows get <ns>` | Flow content through the browser session (canonical view) |
| `manychat-axi template list` | Registered canonical templates |
| `manychat-axi template deploy --spec <f>` | Plan (default) or deploy (`--confirm`) an episode/article spec |
| `manychat-axi flows list --folder <name>` | Narrow to one folder (case-insensitive) |
| `manychat-axi tags list` | All tags |
| `manychat-axi tags ensure "<name>"` | Idempotent tag create (`--confirm` to create) |
| `manychat-axi fields list` | Custom user fields and bot fields |
| `manychat-axi fields ensure "<name>" --type <t>` | Idempotent field create (`--confirm` to create; `--scope bot` for bot fields) |
| `manychat-axi discover` | Record a manual Flow Builder session (dev command) |
| `manychat-axi setup hooks` | Install ambient session context (Claude Code, Codex, OpenCode) |
| `manychat-axi setup status` | Report hook installation without writing |
| `manychat-axi update` | Self-update (built in) |

Every command supports `--json` for machine-readable output and `--help`
for a concise reference.

## Examples

```sh
$ manychat-axi
page:
  name: Dr. Jolene Brighten
  id: 179534895459850
auth:
  api_key: ok
counts:
  flows: 508
  folders: 6
  tags: 289
help[1]: Run `manychat-axi flows list` for the automation inventory

$ manychat-axi flows list --folder Podcasts
flows:
  count: 346
  folder: Podcasts
list[346]{ns,name,folder}:
  content20250519172034_546967,Being Well to DM,Podcasts

$ manychat-axi tags ensure "Podcast | EP170 | Clicked"
error: tags ensure requires --confirm to create tag "Podcast | EP170 | Clicked"
code: VALIDATION_ERROR
help[2]: Would create tag "Podcast | EP170 | Clicked",Rerun with --confirm to apply
```

`ensure` semantics (both tags and fields): an exact-name match reports the
existing record with no mutation and no `--confirm` needed; a
case-insensitive near-match stops loudly instead of creating a duplicate;
creating the missing record requires `--confirm`. Fields cannot change type
after creation - `fields ensure` stops if an existing field has a different
type.

## Conventions

- Default output is compact TOON; `--json` for machine-readable JSON.
- Empty results print explicit `0 flows` / `0 tags` markers, never blank.
- Exit codes: 0 success, 2 usage/validation/missing `--confirm`, 1 runtime
  or API failure (`AUTH_ERROR`, `RATE_LIMITED`, `TIMEOUT`, `NETWORK_ERROR`,
  `API_ERROR`). Errors carry `error`/`code`/`help[]`.
- The CLI spaces requests under ManyChat's documented rate limits
  (reads 100 rps, writes and `getFlows` 10 rps); it never retries writes.
- Tag deletion is intentionally not exposed: ManyChat's removeTag strips the
  tag from every subscriber and cannot be undone.

## Browser session (Phase 1)

The browser transport drives ManyChat's normal web interface in a **visible
Chrome window** using a dedicated persistent profile - never your primary
Chrome profile. Login is manual (2FA / Facebook included); the
Playwright-controlled browser is the only client for app.manychat.com, and
cookies are never exported or replayed.

```sh
manychat-axi auth login            # opens Chrome, you log in, it waits
manychat-axi auth status --browser # launch briefly and verify the session
manychat-axi auth logout --purge   # delete the local profile
```

State lives in `~/.manychat-axi/` (`browser-profile/`, `runs/`, `session.json`,
`lock`); override with `MANYCHAT_STATE_DIR`. One browser session runs at a
time. Google Chrome is used via Playwright's `chrome` channel when installed
(otherwise `npx playwright@latest install chromium` provides a fallback).

### Discovery

`manychat-axi discover` records a manual Flow Builder walkthrough: it starts
a Playwright trace, logs every ManyChat XHR/JSON exchange (including
flow-document bodies, with credential-shaped keys redacted), collects console
errors, and finishes on Enter - writing `trace.zip`, `network.json`,
`documents/`, `console-errors.txt`, `final-screenshot.png`, `aria.yml`,
`dom.html`, and `index.json` under `~/.manychat-axi/runs/discover-<id>/`.
These artifacts feed the Phase 2 selector and canonical-model work.

## Template deployment

Specs live in `manychat/specs/*.yaml` (see `ep167.example.yaml`). One spec
deploys to every registered target: `template deploy` reads the live
templates, checks name conflicts and tag inventory, and prints a full plan
with zero mutations. With `--confirm` it clones each template, renames,
ensures the tag, patches the hook/URL/tag nodes, sets trigger keywords on
every widget, and verifies by independent re-read - stopping at the first
failure. Duplicates stay drafts with inactive triggers; publishing is a
separate gated command (planned).

```sh
manychat-axi template deploy --spec manychat/specs/ep167.yaml           # plan
manychat-axi template deploy --spec manychat/specs/ep167.yaml --confirm # deploy drafts
```

Slot maps per template kind: [docs/templates.md](docs/templates.md).

## Roadmap

Full requirements live in `REQUIREMENTS.md` (see the sibling
`manychat-cli` repo until they move here).

- **Phase 0** - public API foundation: auth, flows inventory,
  tags, fields, home view, setup hooks, skill.
- **Phase 1 (this release)** - browser transport: persistent headed profile,
  manual login, live session probe, `discover` with artifact capture.
- **Phase 2** - flow read (`flows get/pull/diff`) + `template deploy` PoC:
  duplicate the canonical podcast template, apply episode values, verify,
  leave as draft.
- **Phase 3** - flow write (`flows push` via in-page submission),
  `flow publish`, flow-as-code editing loop for agents.
- **Phase 4** - analytics (`stats`, best-effort via browser), skill recipes,
  drift summaries.

## Development

```sh
npm install
npm run build        # tsc -> dist/ (committed; rebuild on every change)
npm test             # vitest, fully mocked - no credentials needed
npm run typecheck
```

Run locally with `node bin/manychat-axi.js`. Network access is isolated to
`src/publicapi/client.ts`; commands receive injected clients and tests pass
fakes. See `AGENTS.md` for the full house rules.

## License

MIT
