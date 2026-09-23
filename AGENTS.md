# AGENTS.md

Guidance for AI agents working in this repository.

## What this is

`manychat-axi` is an AXI-compliant CLI over the ManyChat public API
(api.manychat.com), built toward a full agent-driven ManyChat integration
layer. Phase 0 (this) covers the public API surface: page info, automation
inventory, tags, custom/bot fields. Later phases add a browser transport
(Playwright, visible, persistent profile) for flow content: `flows
get/pull/diff/push`, `template deploy`, and publishing. The requirements
source lives in `~/src-local/manychat-cli/REQUIREMENTS.md` until it moves
here. Keep the AXI principles in mind for every change:

1. TOON output by default, `--json` opt-in
2. 3-4 field list schemas by default
3. Truncate with size hints, `--full` escape hatch
4. Pre-computed aggregates (counts, summaries)
5. Definitive empty states ("0 flows")
6. Structured errors on stdout; exit 2 usage / 1 runtime; unknown flags fail
   loud; never prompt
7. Ambient context via `setup hooks`, opt-in only
8. No-args home view is live content, not help
9. `help[]` next-step suggestions after output
10. Every command has a concise `--help`

## Hard rules

- **Never commit secrets.** `MANYCHAT_API_KEY` comes from the environment
  or a gitignored `.env` in the working directory (env wins; parsed by
  `src/lib/dotenv.ts`, values never logged). Tests must pass with no
  credentials set.
- **Commit `dist/` with every source change.** The build output ships in the
  repo so clone-and-run and GitHub installs need no build step; after editing
  `src/`, run `npm run build` and commit `dist/` in the same change.
- **Network access lives in `src/publicapi/client.ts` and `src/browser/` only.** Commands
  receive an injected client and browser runners; tests pass fakes. Do not
  call `fetch` or launch browsers from command code.
- **Mutations require `--confirm`**, verified before any mutation call. A
  test must exist for each gate proving the mutating client call never
  happens without it. Idempotent `ensure` commands may read first; only the
  create is gated.
- **Exit codes:** `VALIDATION_ERROR` (and only it) maps to exit 2; everything
  else is 1. The SDK's `exitCodeForError` owns this - do not hand-roll it.
- **Key scrubbing:** every error path must pass through `redact()`.

## Layout

```
bin/manychat-axi.js     entrypoint; fast-path version probe, then dist/
src/lib/                args (strict parseArgs), env (config + redaction),
                        output (--json + empty states), truncate, guard
src/publicapi/client.ts the ONLY module that talks to api.manychat.com
src/browser/            session.ts (state dir, lock, persistent launch,
                        auth classification), capture.ts (network
                        interception + redaction), artifacts.ts (run dirs,
                        sanitized snapshots), runners.ts (login/probe/
                        discover orchestration)
src/commands/           one file per command family
src/index.ts            runAxiCli registration
test/                   vitest, fully mocked client and browser runners
skills/manychat-axi/    installable agent skill
```

## Browser transport rules (Phase 1+)

- All browser runs are **headed**. Never headless, never a background daemon.
- One session at a time, enforced by the lock in the state dir.
- The Playwright browser is the **only** client for app.manychat.com: no
  cookie export, no replaying requests through a separate HTTP client.
- The persistent profile lives under `~/.manychat-axi/browser-profile`
  (`MANYCHAT_STATE_DIR` overrides). Never touch the user's primary Chrome
  profile.
- Captured artifacts must pass through `redact()` / `redactJsonText()`:
  no headers, no cookies, no credential-shaped keys in `documents/`.
- Auth detection is heuristic (URL + password-input check) until discovery
  artifacts give us stable DOM markers; revise `classifyUrl` /
  `looksLikeLoginPage` after discovery, not speculatively.

## Commands

```
npm run build       # tsc -> dist/ (committed to the repo; rebuild on change)
npm test            # vitest run
npm run typecheck
```

Run the CLI locally with `node bin/manychat-axi.js` (after `npm run build`).
It works without credentials: the home view and `auth status` report the
unconfigured state and make zero API calls.

Live ManyChat testing is an explicit local operation. With a real
`MANYCHAT_API_KEY` exported, prefer read-only commands (`flows list`,
`tags list`) and gated previews (mutations without `--confirm`) when
verifying against production.
