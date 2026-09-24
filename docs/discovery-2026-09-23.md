# Discovery analysis — 2026-09-23

Source run: `~/.manychat-axi/runs/discover-20260923-201704-1abe/` (83 exchanges,
26 documents, full Playwright trace). Template demonstrated:
`content20260922154445_584682` ("EP166 to DM FB", folder /23495021/27592482 =
"Podcasts", page fb1071254). All endpoints below are internal app.manychat.com
APIs exercised by the Flow Builder itself, captured inside the authenticated
browser session.

## Endpoint map

| Purpose | Method + path | Notes |
| --- | --- | --- |
| Flow document | `GET /fb{page}/flow/getFlowData?ns={ns}` | `{flow: {...}, state: {...}}`; `flow.contents[]` = node array |
| CMS object meta | `GET /fb{page}/cms/getObject?path=/23495021/27592482/{ns}` | fs_object: title, folder_id, timestamps |
| Folder listing | `GET /fb{page}/cms/getFlows?path={path}&field=modified&order=desc` | paginated folder contents |
| Folders tree | `GET /fb{page}/cms/getFolders` / `POST /fb{page}/folders/list` | |
| **Duplicate flow** | `GET /fb{page}/cms/clone?path=/{ns}` | Auto-names "copy", "copy 2"; clones trigger widgets too; returns full fs_object with the NEW ns |
| **Rename flow** | `POST /fb{page}/cms/rename` | `{path: "/23495021/27592482/{ns}", title, client_id}` (from run discover-20260924-073214-ca60) |
| **Edit flow nodes** | `POST /fb{page}/flow/patchDraft` | `{ns, batch: {contents: [<full node objects>]}}`; nodes identified by `_oid` + `content_id` |
| **Publish flow** | `POST /fb{page}/flow/publish` | full draft state: `{ns, batch: {contents: [ALL nodes], root_content, context}, coordinates: {startingStep, per-oid}, client_id}` (from run discover-20260924-073214-ca60) |
| Widget read | `GET /fb{page}/growth-tools/loadWidget?widget_id={id}` | `{widget: {...}, state}` |
| **Edit trigger** | `POST /fb{page}/growth-tools/setWidget` | full widget object; keywords in `data.feed_comment_settings.include_keywords_array` |
| **Activate trigger** | `POST /fb{page}/growth-tools/setDraftStatus?widget_id={id}&status=active` | makes the comment trigger live |
| Create tag (web) | `POST /fb{page}/tags/create` | `{tag_name, path, client_id}` → returns tag id |
| Tags list (web) | `GET /fb{page}/tags/list?type=user` | |

Console errors in the run are analytics/CDN noise (404/405, cross-origin
blocks, one 429) — not actionable.

## Node model (template flow, 6 contents)

```text
[action_group "Actions #1"]  ← root
[default "Send Message"]     quick_reply button "Send me the link!" → jumps to "Send Message #1"
[default "Send Message #1"]  text + keyboard[0] = url button (destination URL) → targets "Actions #2"
[default "Send Message #2"]
[action_group "Actions #2"]  actions: [{type: "add_tag", tag_id}]  ← the click tag
[smart_delay "Smart Delay"]
```

Connections are embedded per node: `quick_replies.buttons[].content_id`,
`keyboard[].target.content_id`, `action_group.target.content_id`. No separate
edge list.

## Episode value → location mapping

| Episode value | Location | Write mechanism |
| --- | --- | --- |
| Flow name | `flow.name` / fs_object title | `cms/rename` |
| Trigger keywords | duplicate's widget: `data.feed_comment_settings.include_keywords_array` (array is authoritative; `include_keywords` string lags) | `growth-tools/setWidget` |
| Opening DM hook | message node `messages[0].content.text` | `flow/patchDraft` |
| Destination URL | delivery message `messages[0].keyboard[0].url` (button `caption` e.g. "Listen Now!") | `flow/patchDraft` |
| Click tag | action_group `actions[type=add_tag].tag_id` | `tags/create` (or public API `tags ensure`) then `flow/patchDraft` |
| Trigger go-live | widget status | `growth-tools/setDraftStatus?status=active` |
| Flow publish | full draft submission | `flow/publish` |

## Key findings and safety notes

1. **`cms/clone` clones trigger widgets.** Template widget 60411074 →
   duplicate got NEW widget 60500995. Editing the duplicate's keywords did
   NOT touch the template. Verified via getFlowData of both.
2. **Duplication fired twice** in the demo — copies
   `content20260924021959_680299` ("EP166 to DM FB copy") and
   `content20260924022016_617606` ("EP166 to DM FB copy 2", untouched
   orphan). Idempotency/conflict checks in `template deploy` are mandatory,
   and the orphan needs manual cleanup.
3. **The first demo left the duplicate's trigger LIVE** with keywords
   ["TEST TRIGGER", "TESTTRIGGER"] (setDraftStatus=active) — resolved in the
   second pass (renamed to "EP167 to DM FB copy" and published 2026-09-24).
4. **patchDraft patches full node objects** — read-modify-write per node
   using `_oid`/`content_id` from getFlowData. No partial-field ops.
5. **publish submits the entire flow** (all nodes + coordinates), not a
   diff — `flow publish` must re-read the current draft and submit it.
6. Comment triggers are growth-tool widgets; FB variant is
   `feed_comment_trigger` (IG template still to capture).
7. Full template node inventory (6 nodes): Actions #1
   (set_custom_field_value nowDateTime, field 14998316) → Send Message
   (hook + "Send me the link!" quick reply) → Send Message #1 (delivery +
   URL button) → Actions #2 (add_tag) → Smart Delay (6h, 08:00-22:00 all
   week) → Send Message #2 (static Apple-review follow-up).

## Multi-account reality (2026-09-24)

Episodes launch on more than the drjolenebrighten account (fb1071254): the
podcast has its own Instagram and Facebook accounts. Templates are
per-account and per-channel (podcast-FB, podcast-IG, article variants).
Phase 2 needs named accounts (browser profiles + API keys per account) and
a typed template registry before `template deploy`.

## Phase 2 implications

- `flows get <ns>`: capture `flow/getFlowData` in-session → canonical model.
- `template deploy`: clone → rename → tags ensure → patchDraft (DM text,
  URL) → setWidget (keywords) → verify via fresh getFlowData + loadWidget →
  leave draft; publish is a separate gated command (`flow/publish`).
- Verification reads are cheap and independent: getFlowData + loadWidget +
  cms/getObject.
