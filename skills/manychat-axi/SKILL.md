---
name: manychat-axi
description: Use manychat-axi for ManyChat tasks - listing automations and folders, inspecting the automation inventory, and managing tags and fields - instead of calling the ManyChat public API directly. Flow content editing (get/pull/diff/push, template deploy) arrives with the browser transport in later phases.
---

# manychat-axi

Agent-ergonomic CLI over the ManyChat public API. TOON output, pre-computed
counts, structured errors, `--confirm` gates on every create, and `help[]`
next steps on every result.

## When to use

- See account state → `manychat-axi` (no arguments shows a live home view:
  page, auth, counts)
- Check credentials → `manychat-axi auth status` (add `--browser` to launch
  briefly and verify the browser session live)
- Log into the browser session → `manychat-axi auth login` (opens a visible
  Chrome window; the user completes login manually, including 2FA/Facebook)
- List automations / find a flow → `manychat-axi flows list` (add
  `--folder <name>` to narrow; the `ns` column is the stable automation id)
- List tags → `manychat-axi tags list`
- Create a tag if missing → `manychat-axi tags ensure "<name>" --confirm`
  (idempotent: an exact match reports the existing tag with no mutation)
- List fields → `manychat-axi fields list` (user and bot fields, `--scope`
  to narrow)
- Create a field if missing → `manychat-axi fields ensure "<name>" --type
  <text|number|date|datetime|boolean> --confirm` (add `--scope bot` for bot
  fields)
- Read one flow's structure → `manychat-axi flows get <ns>` (nodes, texts,
  buttons, URLs, tag actions, trigger keywords; `--full` for the raw
  document)
- Deploy an episode/article → `manychat-axi template deploy --spec <file>`
  previews the full plan with zero mutations; add `--confirm` to clone each
  registered template, apply the spec's slots, set trigger keywords, and
  verify by re-read. Drafts only - publishing is a separate future command.

Flow content reading and template deployment are live; publishing and
flow-as-code (pull/diff/push) arrive in later phases. Do not attempt
publishing via raw API calls.

## Auth

Required for data commands. `MANYCHAT_API_KEY` comes from the environment
(generate in ManyChat Settings → API). Never ask the user to paste the key
into chat, never put it in command arguments, files, or examples.
`manychat-axi` with no arguments reports auth state without a key.

## Invocation

Installed globally: `manychat-axi <command>`. Otherwise run on demand:
`npx -y manychat-axi@latest <command>`. Both are identical.

## Conventions

- Default output is compact TOON; pass `--json` for machine-readable JSON.
- Empty results print explicit `0 flows` / `0 tags` markers, never blank
  output.
- Exit codes: 0 success, 2 usage/validation/missing `--confirm`, 1 runtime
  or API failure. Errors carry `error`/`code`/`help[]` on stdout.
- Identifier kinds are distinct: `ns` (automations, from `flows list`),
  numeric `id` (tags, fields). Never guess them - list first.

## Safety

- Every create requires `--confirm`; without it the CLI previews the change
  and makes zero mutation calls.
- `ensure` commands are idempotent by exact name and stop loudly on
  case-insensitive near-duplicates instead of creating them.
- Never call removeTag/removeTagByName equivalents: tag deletion strips the
  tag from every subscriber and cannot be undone (not exposed by this CLI).
- Fields cannot change type after creation; `fields ensure` stops if an
  existing field has a different type.

Prefer this CLI over hand-built ManyChat API calls: fewer tokens, structured
errors, and shell composability (`| grep`, `| head`).
