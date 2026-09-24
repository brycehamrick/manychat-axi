# Template registry

Which flow types are templatized, what varies per instance, and where each
value lives. Verified against live templates on 2026-09-24 via
`flows get` and widget reads. Endpoint semantics: docs/discovery-2026-09-23.md.

## Accounts

| Account | Page | Notes |
| --- | --- | --- |
| brighten (drjolenebrighten) | fb1071254 | default; all four templates below live here |
| show (drbrightenshow) | fb2263759 | podcast's own FB/IG presence |
| essentials (drbrightenessentials) | fb1071318 | product line |

One ManyChat login covers all three (account switcher). Public API keys are
per account (`MANYCHAT_API_KEY__<NAME>`); the key's prefix equals the page
segment (e.g. `2263759:...` -> fb2263759).

## Folders (brighten)

- Podcasts: cms path `/23495021/27592482`
- Articles: cms path `/23495021/27592484`

## Kinds and slots

### podcast-fb — "EP166 to DM FB" (content20260922154445_584682)

6 nodes; one trigger (`feed_comment_trigger`). Slots:

| Slot | Location |
| --- | --- |
| name | flow title (cms rename) |
| keywords | widget `feed_comment_settings.include_keywords_array` (e.g. EP166, EP 166) |
| hook | "Send Message" `messages[0].content.text` |
| url | "Send Message #1" `keyboard[0].url` |
| tag | "Actions #2" `add_tag` |

### podcast-ig — "EP166 to DM" (content20260922154440_676729)

Same 6-node shape, node type `instagram`, **two triggers** (comment + story
reply) sharing the same keyword list.

### article-ig (plain) — "ADHD PERIODS Comment to DM" (content20260803081747_913909)

8 nodes; two triggers (comment + story reply). Same five core slots, plus:

| Slot | Location | Notes |
| --- | --- | --- |
| keywords | BOTH widgets (same array) | variants auto-derived, see below |
| url | "First message" AND "Send Message #1" keyboards | **appears twice - must stay in sync** |
| tag | "Actions" and/or "Actions #1" | one tag per delivery path |
| utm | appended to both urls | e.g. `?utm_source=instagram&utm_medium=manychat&utm_campaign=<slug>` |

### article-ig-offer — "D3 GUIDE to Article" (content20260809140651_541729)

Plain article plus a `multi_condition` gate: if the subscriber carries the
offer tag (e.g. 93799251) before the reminder, route differently. Two tags
(article tag + offer tag). Everything else as plain.

## Keyword variants

Observed derivation from the primary keyword K (uppercase):

- Podcast: `EP166` -> ["EP166", "EP 166"]
- Article: `ADHD PERIODS` -> ["ADHD PERIODS", "ADHDPERIODS", "ADHD PERIOD",
  "ADHDPERIOD"] (spaced + unspaced, plural + singular last word)

Specs should carry the explicit list; the CLI derives the standard variants
when only the primary keyword is given.

## Cross-account deployment

The same podcast launches on `show` (the podcast's own FB + IG). Templates
for the show account are TBD: clone the brighten templates there once,
export the show account's keys, and register the new template nss. Episode
specs then declare their target list and `template deploy` iterates
accounts (draft-only, `--confirm` gated).

## Slot -> operation map (all kinds)

| Operation | Endpoint |
| --- | --- |
| Duplicate | `cms/clone?path=/<ns>` (auto-names "copy"; clones widgets) |
| Rename | `cms/rename {path, title}` |
| Tag ensure | public API `tags ensure` (or web `tags/create`) |
| Hook / url / tag edits | `flow/patchDraft {ns, batch.contents[<full node>]}` (read-modify-write) |
| Keywords | `growth-tools/setWidget` per trigger widget |
| Trigger go-live | `growth-tools/setDraftStatus?status=active` |
| Flow publish | `flow/publish` (full contents + coordinates) |
