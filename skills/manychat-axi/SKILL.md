---
name: manychat-axi
description: Use manychat-axi for ManyChat tasks - listing automations, reading flow content, managing tags and fields, and deploying podcast/article flows from specs - instead of calling ManyChat APIs directly. Includes the full episode workflow: generate messaging from episode copy, preview, deploy across accounts after approval.
---

# manychat-axi

Agent-ergonomic CLI over the ManyChat public API and an authenticated
browser session. TOON output, pre-computed counts, structured errors,
`--confirm` gates on mutations, and `help[]` next steps on every result.

## The episode/article workflow

When the user says "generate a manychat flow for a new podcast episode"
(or article):

1. **Collect inputs**: episode number (or article slug), the episode title,
   and source copy - webpage copy and/or the YouTube description. Also the
   destination link (drbrt.in shortlink or article URL). Ask for anything
   missing before drafting.
2. **Draft the spec** at `manychat/specs/ep<N>.yaml` following the
   conventions below. The agent writes the messaging; the CLI only deploys.
3. **Preview**: `manychat-axi template deploy --spec <file>` (no flags) -
   zero mutations, shows the full plan. Show the user the draft copy
   (hook especially) and get explicit approval.
4. **Deploy after approval**: rerun with `--confirm`. Report the created
   flow nss per target. Deployments are drafts with inactive triggers -
   publishing happens in ManyChat (a gated publish command is planned).

## Messaging conventions (from live templates)

- **Podcast hook** (2 sentences max): problem-question in the listener's
  voice, then "Tap below and I'll send you Dr. Brighten's answers."
  Examples from real episodes:
  - "Endometriosis symptoms getting worse in perimenopause? It's not as
    simple as 'too much estrogen.' Tap below for Dr. Brighten's answers."
  - "Here's my guide to vitamin D benefits, testing, and ways to support
    healthy levels" (article delivery style - short, warm, 💛 where it fits)
- **Delivery message**: one short line + the link button ("Listen Now!" for
  podcasts, "Read the Article" for articles).
- **Tag naming** (real account conventions):
  - Podcast: `click-ep-<N>` (lowercase, hyphenated; same name on every
    account - each account holds its own tag with that name)
  - Article: `click-<slug>` (IG default) / `click-<slug>-fb` (FB variant)
  - Offer gate: `trigger-<slug>-offer`
- **Keywords**: podcast `EP<N>` (variants auto-derive); article = the
  uppercase title with space/no-space/singular variants auto-derived.
- **URLs**: use the exact link the user provides (drbrt.in shortlinks for
  episodes). Never invent or shorten links. Articles may carry
  `utm_campaign=<slug>` - set `utm:` in the spec and the CLI appends the
  UTM block.
- **Spec fields**: version, episode|title, keyword|keywords, hook, url,
  tag, utm (optional), targets. Targets come from `manychat/config.yaml`
  (`manychat-axi template list`).

## Other commands

- See account state → `manychat-axi` (live home view)
- Check credentials → `manychat-axi auth status` (`--browser` probes live)
- Log into the browser session → `manychat-axi auth login` (visible browser,
  chosen by Playwright - default "Google Chrome for Testing"; axi never pins
  a channel or executable. Manual login incl. 2FA/Facebook)
- List automations / find a flow → `manychat-axi flows list` (`--folder`)
- Read one flow's structure → `manychat-axi flows get <ns>` (`--full` for raw)
- List tags → `manychat-axi tags list`; create if missing →
  `manychat-axi tags ensure "<name>" --confirm`
- Fields → `manychat-axi fields list` / `fields ensure "<name>" --type <t> --confirm`
- Registry → `manychat-axi template list`

## Auth

Required for data commands. `MANYCHAT_API_KEY` (default account) and
`MANYCHAT_API_KEY__<ACCOUNT>` (per account) come from the environment or a
gitignored `.env` in the working directory. Never ask the user to paste
keys into chat, never put them in command arguments, files, or examples.

## Invocation

Installed globally: `manychat-axi <command>`. Otherwise:
`npx -y manychat-axi@latest <command>`. The project config
(`manychat/config.yaml`) is found from the working directory upward, or via
`MANYCHAT_CONFIG=<path>`.

## Conventions

- Default output is compact TOON; pass `--json` for machine-readable JSON.
- Empty results print explicit `0 flows` markers, never blank output.
- Exit codes: 0 success, 2 usage/validation/missing `--confirm`, 1 runtime
  or API failure. Errors carry `error`/`code`/`help[]`.
- Identifier kinds are distinct: `ns` (automations), numeric tag ids. Never
  guess - list first.

## Safety

- Every mutation requires `--confirm`; previews make zero mutation calls.
- Deployments never publish and never activate triggers.
- Deploy stops at the first failed target; failures leave the draft for
  inspection. Nothing is ever auto-deleted.
- Tag deletion is intentionally not exposed (irreversible in ManyChat).
