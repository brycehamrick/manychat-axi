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
- Check credentials → `manychat-axi auth status`
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

Flow content (reading nodes, editing flows, publishing, template deploy) is
NOT available yet - it needs the browser transport (Phase 1+). Do not
attempt it via raw API calls; the public API does not expose flow content.

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
