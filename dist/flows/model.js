/**
 * Canonical flow model: a stable, token-efficient view over ManyChat's
 * getFlowData documents. Discovery-informed shapes live in
 * docs/discovery-2026-09-23.md; unknown fields stay accessible via --full.
 */
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function str(value) {
    return typeof value === "string" ? value : undefined;
}
function num(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function summarizeMessage(message, buttons) {
    const parts = [];
    const content = message["content"];
    if (isRecord(content)) {
        const text = str(content["text"]);
        if (text)
            parts.push(text);
    }
    const keyboard = message["keyboard"];
    if (Array.isArray(keyboard)) {
        for (const entry of keyboard) {
            if (!isRecord(entry))
                continue;
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
export function summarizeNode(raw) {
    // Read shape (getFlowData): full content lives under `data`.
    // Write shape (patchDraft): the same fields are flattened onto the node.
    const data = isRecord(raw["data"]) ? raw["data"] : raw;
    const buttons = [];
    const texts = [];
    const quickReplies = data["quick_replies"];
    if (isRecord(quickReplies) && Array.isArray(quickReplies["buttons"])) {
        for (const button of quickReplies["buttons"]) {
            if (!isRecord(button))
                continue;
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
            if (isRecord(message))
                texts.push(summarizeMessage(message, buttons));
        }
    }
    const actions = [];
    if (Array.isArray(data["actions"])) {
        for (const action of data["actions"]) {
            if (!isRecord(action))
                continue;
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
export function summarizeWidget(raw) {
    const settings = isRecord(raw["data"]) && isRecord(raw["data"]["feed_comment_settings"])
        ? raw["data"]["feed_comment_settings"]
        : undefined;
    const keywords = settings && Array.isArray(settings["include_keywords_array"])
        ? settings["include_keywords_array"].filter((k) => typeof k === "string")
        : undefined;
    return {
        widget_id: num(raw["widget_id"]) ?? -1,
        widget_type: str(raw["widget_type"]) ?? "unknown",
        ...(str(raw["status"]) ? { status: str(raw["status"]) } : {}),
        ...(str(raw["name"]) ? { name: str(raw["name"]) } : {}),
        ...(keywords ? { keywords } : {}),
    };
}
export function summarizeFlowDocument(doc) {
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
