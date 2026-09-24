/**
 * Canonical flow model: a stable, token-efficient view over ManyChat's
 * getFlowData documents. Discovery-informed shapes live in
 * docs/discovery-2026-09-23.md; unknown fields stay accessible via --full.
 */

export interface FlowWidgetSummary {
  widget_id: number;
  widget_type: string;
  status?: string;
  keywords?: string[];
}

export interface FlowNodeButton {
  kind: "quick_reply" | "url";
  caption: string;
  /** url buttons only. */
  url?: string;
  /** Node this button jumps to, when it does. */
  targetContentId?: number;
}

export interface FlowNodeAction {
  type: string;
  /** add_tag only. */
  tagId?: number;
}

export interface FlowNodeSummary {
  contentId: number;
  oid: string;
  type: string;
  caption: string;
  /** Concatenated text of message nodes. */
  text?: string;
  buttons: FlowNodeButton[];
  actions: FlowNodeAction[];
  /** Node executed after this one, when declared. */
  nextContentId?: number;
}

export interface FlowSummary {
  ns: string;
  name: string;
  status: string;
  hasUnpublishedChanges: boolean;
  rootContentId: number;
  nodes: FlowNodeSummary[];
  widgets: FlowWidgetSummary[];
  nodeCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function summarizeMessage(message: Record<string, unknown>, buttons: FlowNodeButton[]): string {
  const parts: string[] = [];
  const content = message["content"];
  if (isRecord(content)) {
    const text = str(content["text"]);
    if (text) parts.push(text);
  }
  const keyboard = message["keyboard"];
  if (Array.isArray(keyboard)) {
    for (const entry of keyboard) {
      if (!isRecord(entry)) continue;
      const caption = str(entry["caption"]) ?? "";
      const url = str(entry["url"]);
      if (str(entry["type"]) === "url" || url) {
        const target = isRecord(entry["target"]) ? entry["target"] : undefined;
        const targetContentId = target ? num(target["content_id"]) : undefined;
        buttons.push({
          kind: "url",
          caption,
          ...(url ? { url } : {}),
          ...(targetContentId !== undefined ? { targetContentId } : {}),
        });
      }
    }
  }
  return parts.join("\n");
}

export function summarizeNode(raw: Record<string, unknown>): FlowNodeSummary {
  // Read shape (getFlowData): full content lives under `data`.
  // Write shape (patchDraft): the same fields are flattened onto the node.
  const data = isRecord(raw["data"]) ? (raw["data"] as Record<string, unknown>) : raw;
  const buttons: FlowNodeButton[] = [];
  const texts: string[] = [];

  const quickReplies = data["quick_replies"];
  if (isRecord(quickReplies) && Array.isArray(quickReplies["buttons"])) {
    for (const button of quickReplies["buttons"]) {
      if (!isRecord(button)) continue;
      const contentId = num(button["content_id"]);
      buttons.push({
        kind: "quick_reply",
        caption: str(button["caption"]) ?? "",
        ...(contentId !== undefined ? { targetContentId: contentId } : {}),
      });
    }
  }

  const messages = data["messages"];
  if (Array.isArray(messages)) {
    for (const message of messages) {
      if (isRecord(message)) texts.push(summarizeMessage(message, buttons));
    }
  }

  const actions: FlowNodeAction[] = [];
  if (Array.isArray(data["actions"])) {
    for (const action of data["actions"]) {
      if (!isRecord(action)) continue;
      actions.push({
        type: str(action["type"]) ?? "unknown",
        ...(num(action["tag_id"]) !== undefined ? { tagId: num(action["tag_id"]) } : {}),
      });
    }
  }

  const target = data["target"];
  const nextContentId = isRecord(target) ? num(target["content_id"]) : undefined;

  const text = texts.join("\n").trim();
  return {
    contentId: num(raw["content_id"]) ?? -1,
    oid: str(data["_oid"]) ?? str(raw["_oid"]) ?? "",
    type: str(raw["type"]) ?? "unknown",
    caption: str(raw["caption"]) ?? "",
    ...(text.length > 0 ? { text } : {}),
    buttons,
    actions,
    ...(nextContentId !== undefined ? { nextContentId } : {}),
  };
}

export function summarizeWidget(raw: Record<string, unknown>): FlowWidgetSummary {
  const settings =
    isRecord(raw["data"]) && isRecord(raw["data"]["feed_comment_settings"])
      ? (raw["data"]["feed_comment_settings"] as Record<string, unknown>)
      : undefined;
  const keywords = settings && Array.isArray(settings["include_keywords_array"])
    ? settings["include_keywords_array"].filter((k): k is string => typeof k === "string")
    : undefined;
  return {
    widget_id: num(raw["widget_id"]) ?? -1,
    widget_type: str(raw["widget_type"]) ?? "unknown",
    ...(str(raw["status"]) ? { status: str(raw["status"]) as string } : {}),
    ...(str(raw["name"]) ? { name: str(raw["name"]) as string } : {}),
    ...(keywords ? { keywords } : {}),
  };
}

export function summarizeFlowDocument(doc: Record<string, unknown>): FlowSummary {
  const flow = doc["flow"];
  if (!isRecord(flow)) {
    throw new Error("flow document has no flow object");
  }
  const contents = Array.isArray(flow["contents"]) ? flow["contents"] : [];
  const nodes = contents
    .filter(isRecord)
    .map(summarizeNode)
    .sort((a, b) => a.contentId - b.contentId);
  const triggers = isRecord(flow["triggers"]) ? flow["triggers"] : {};
  const widgets = Array.isArray(triggers["widgets"])
    ? triggers["widgets"].filter(isRecord).map(summarizeWidget)
    : [];
  return {
    ns: str(flow["ns"]) ?? "",
    name: str(flow["name"]) ?? "",
    status: str(flow["status"]) ?? "unknown",
    hasUnpublishedChanges: flow["has_unpublished_changes"] === true,
    rootContentId: num(flow["root_content_id"]) ?? -1,
    nodes,
    widgets,
    nodeCount: nodes.length,
  };
}
