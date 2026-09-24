import { AxiError } from "axi-sdk-js";
import { deriveName } from "./spec.js";
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function num(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
export function readTemplateShape(doc) {
    const flow = doc["flow"];
    if (!isRecord(flow))
        throw new AxiError("template document has no flow object", "APP_API_ERROR");
    const contents = Array.isArray(flow["contents"]) ? flow["contents"] : [];
    const nodes = contents.filter(isRecord).map((node) => node);
    const rootContentId = num(flow["root_content_id"]) ?? -1;
    const triggers = isRecord(flow["triggers"]) ? flow["triggers"] : {};
    const widgets = Array.isArray(triggers["widgets"])
        ? triggers["widgets"].filter(isRecord)
        : [];
    // Hook node = target of the root action group.
    const root = nodes.find((node) => node.content_id === rootContentId);
    const rootData = isRecord(root?.["data"]) ? root?.["data"] : undefined;
    const rootTarget = isRecord(rootData?.["target"]) ? rootData?.["target"] : undefined;
    const hookNodeId = num(rootTarget?.["content_id"]);
    // Primary tag = most frequently referenced add_tag tag id.
    const tagCounts = new Map();
    for (const node of nodes) {
        const data = isRecord(node["data"]) ? node["data"] : undefined;
        if (data && Array.isArray(data["actions"])) {
            for (const action of data["actions"]) {
                if (!isRecord(action) || action["type"] !== "add_tag")
                    continue;
                const tagId = num(action["tag_id"]);
                if (tagId !== undefined)
                    tagCounts.set(tagId, (tagCounts.get(tagId) ?? 0) + 1);
            }
        }
    }
    let primaryTagId;
    let best = 0;
    for (const [tagId, count] of tagCounts) {
        if (count > best || (count === best && tagId < (primaryTagId ?? Infinity))) {
            primaryTagId = tagId;
            best = count;
        }
    }
    return {
        ns: typeof flow["ns"] === "string" ? flow["ns"] : "",
        name: typeof flow["name"] === "string" ? flow["name"] : "",
        nodes,
        rootContentId,
        hookNodeId,
        widgets,
        ...(primaryTagId !== undefined ? { primaryTagId } : {}),
    };
}
/** Convert a read-shape node (content under `data`) into patchDraft write shape. */
export function toWriteShape(node, namespace) {
    const header = {
        type: node["type"],
        caption: node["caption"],
        content_id: node["content_id"],
    };
    const data = isRecord(node["data"]) ? node["data"] : {};
    return { ...header, ...data, namespace, removed: false };
}
function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}
/** Apply spec edits to a node's data, returning the write-shape node when changed. */
export function editNode(node, namespace, edits, staticUrls, nodeRoleHookId) {
    const original = toWriteShape(node, namespace);
    const draft = deepClone(original);
    let changed = false;
    if (edits.hook !== undefined && node.content_id === nodeRoleHookId) {
        const messages = draft["messages"];
        if (Array.isArray(messages) && isRecord(messages[0])) {
            const content = messages[0]["content"];
            if (isRecord(content)) {
                content["text"] = edits.hook;
                changed = true;
            }
        }
    }
    if (edits.url !== undefined) {
        const messages = draft["messages"];
        if (Array.isArray(messages)) {
            for (const message of messages) {
                if (!isRecord(message))
                    continue;
                const keyboard = message["keyboard"];
                if (!Array.isArray(keyboard))
                    continue;
                for (const button of keyboard) {
                    if (!isRecord(button) || button["type"] !== "url")
                        continue;
                    const url = button["url"];
                    if (typeof url !== "string")
                        continue;
                    if (staticUrls.includes(url))
                        continue;
                    button["url"] = edits.url.replace(url);
                    changed = true;
                }
            }
        }
    }
    if (edits.tags !== undefined) {
        const actions = draft["actions"];
        if (Array.isArray(actions)) {
            for (const action of actions) {
                if (!isRecord(action) || action["type"] !== "add_tag")
                    continue;
                if (action["tag_id"] === edits.tags.from) {
                    action["tag_id"] = edits.tags.to;
                    changed = true;
                }
            }
        }
        // multi_condition filters can reference the same tag (offer gate).
        const conditions = draft["conditions"];
        if (Array.isArray(conditions)) {
            for (const condition of conditions) {
                if (!isRecord(condition))
                    continue;
                const filter = condition["filter"];
                if (!isRecord(filter))
                    continue;
                const groups = filter["groups"];
                if (!Array.isArray(groups))
                    continue;
                for (const group of groups) {
                    if (!isRecord(group) || !Array.isArray(group["items"]))
                        continue;
                    for (const item of group["items"]) {
                        if (isRecord(item) && item["value"] === edits.tags.from) {
                            item["value"] = edits.tags.to;
                            changed = true;
                        }
                    }
                }
            }
        }
    }
    return changed ? draft : undefined;
}
/* ------------------------------------------------------------------ */
/* Widget keyword updates                                              */
/* ------------------------------------------------------------------ */
export function applyKeywordsToWidget(widget, keywords) {
    const draft = deepClone(widget);
    const data = isRecord(draft["data"]) ? draft["data"] : undefined;
    if (data && isRecord(data["feed_comment_settings"])) {
        const settings = data["feed_comment_settings"];
        settings["include_keywords_array"] = keywords;
        settings["include_keywords"] = keywords.join(",");
    }
    else if (data && Array.isArray(data["keywords"])) {
        data["keywords"] = keywords;
    }
    return draft;
}
/* ------------------------------------------------------------------ */
/* Planning                                                            */
/* ------------------------------------------------------------------ */
function withUtm(url, utm, templateHasUtm) {
    if (!utm || !templateHasUtm)
        return url;
    const parsed = new URL(url);
    parsed.searchParams.set("utm_source", "instagram");
    parsed.searchParams.set("utm_medium", "manychat");
    parsed.searchParams.set("utm_campaign", utm);
    return parsed.toString();
}
export async function planTarget(spec, template, deps) {
    const name = deriveName(template.kind, spec, template.namePattern);
    const doc = await deps.withApp({ page: template.page, stateDir: deps.stateDir, loginTimeoutMs: 0 }, async (api) => api.getFlowData(template.ns));
    const shape = readTemplateShape(doc);
    const templateUrls = collectUrls(shape.nodes);
    const templateHasUtm = [...templateUrls].some((url) => url.includes("utm_"));
    const client = deps.publicClientFor(template.apiKey);
    const tags = await client.getTags();
    const existingTag = tags.find((tag) => tag.name === spec.tagName);
    const flows = await client.getFlows();
    const conflict = flows.flows.find((flow) => flow.name === name);
    return {
        template: template.template,
        kind: template.kind ?? "unknown",
        account: template.account,
        page: template.page,
        name,
        templateNs: template.ns,
        keywords: spec.keywords,
        hook: spec.hook,
        url: withUtm(spec.url, spec.utm, templateHasUtm),
        tagName: spec.tagName,
        ...(existingTag ? { tagId: existingTag.id } : {}),
        ...(shape.primaryTagId !== undefined ? { templateTagId: shape.primaryTagId } : {}),
        staticUrls: template.staticUrls ?? [],
        ...(conflict ? { conflict: { ns: conflict.ns, name: conflict.name } } : {}),
    };
}
function collectUrls(nodes, staticUrls = []) {
    const urls = new Set();
    for (const node of nodes) {
        const data = isRecord(node["data"]) ? node["data"] : undefined;
        const messages = data && Array.isArray(data["messages"]) ? data["messages"] : [];
        for (const message of messages) {
            if (!isRecord(message))
                continue;
            const keyboard = message["keyboard"];
            if (!Array.isArray(keyboard))
                continue;
            for (const button of keyboard) {
                if (!isRecord(button) || typeof button["url"] !== "string")
                    continue;
                if (button["type"] === "url" && !staticUrls.includes(button["url"])) {
                    urls.add(button["url"]);
                }
            }
        }
    }
    return urls;
}
/* ------------------------------------------------------------------ */
/* Execution                                                           */
/* ------------------------------------------------------------------ */
export async function deployTarget(plan, spec, deps, template) {
    const stages = [];
    const result = {
        template: plan.template,
        account: plan.account,
        name: plan.name,
        stages,
        status: "failed",
    };
    // 1. Tag resolution (public API; created idempotently when missing - the
    // whole deploy is already --confirm gated).
    let tagId = plan.tagId;
    if (tagId === undefined) {
        const client = deps.publicClientFor(template.apiKey);
        tagId = (await client.createTag(plan.tagName)).id;
        stages.push(`tag-created:${plan.tagName}#${tagId}`);
    }
    else {
        stages.push(`tag:${plan.tagName}#${tagId}`);
    }
    if (plan.conflict) {
        throw new AxiError(`target ${plan.template}: a flow named "${plan.name}" already exists (${plan.conflict.ns})`, "VALIDATION_ERROR", ["Pick a different episode/name, or delete/rename the existing flow in ManyChat first"]);
    }
    return deps.withApp({ page: plan.page, stateDir: deps.stateDir, loginTimeoutMs: 0 }, async (api) => {
        // 2. Read the template fresh.
        const templateDoc = await api.getFlowData(plan.templateNs);
        const shape = readTemplateShape(templateDoc);
        stages.push("template-read");
        // 3. Clone.
        const cloneResponse = await api.clone(`/${plan.templateNs}`);
        const fsObject = isRecord(cloneResponse["fs_object"]) ? cloneResponse["fs_object"] : undefined;
        const flow = fsObject && isRecord(fsObject["flow"]) ? fsObject["flow"] : undefined;
        const newNs = typeof flow?.["ns"] === "string" ? flow["ns"] : undefined;
        const newPath = typeof fsObject?.["path"] === "string" ? fsObject["path"] : undefined;
        if (!newNs || !newPath || newNs === plan.templateNs) {
            throw new AxiError(`clone of ${plan.templateNs} did not produce a new flow ns`, "APP_API_ERROR", ["Nothing was edited; inspect the account in ManyChat"]);
        }
        result.ns = newNs;
        stages.push("cloned");
        // 4. Rename.
        await api.rename(newPath, plan.name);
        stages.push("renamed");
        // 5. Patch nodes: hook, urls, tags.
        const changed = [];
        for (const node of shape.nodes) {
            const edited = editNode(node, newNs, {
                hook: plan.hook,
                url: { replace: () => plan.url },
                ...(plan.templateTagId !== undefined && tagId !== undefined
                    ? { tags: { from: plan.templateTagId, to: tagId } }
                    : {}),
            }, plan.staticUrls, shape.hookNodeId);
            if (edited)
                changed.push(edited);
        }
        if (changed.length > 0) {
            await api.patchDraft(newNs, { contents: changed });
        }
        stages.push(`patched:${changed.length}nodes`);
        // 6. Keywords on every trigger widget.
        for (const widget of shape.widgets) {
            const widgetId = num(widget["widget_id"]);
            if (widgetId === undefined)
                continue;
            const loaded = await api.loadWidget(widgetId);
            const widgetObj = isRecord(loaded["widget"]) ? loaded["widget"] : loaded;
            const updated = applyKeywordsToWidget(widgetObj, plan.keywords);
            await api.setWidget(updated);
            stages.push(`widget:${widgetId}`);
        }
        // 7. Verify by independent re-read.
        const verifyDoc = await api.getFlowData(newNs);
        const verifiedShape = readTemplateShape(verifyDoc);
        const checks = {
            name: verifiedShape.name === plan.name,
            hook: verifiedShape.hookNodeId !== undefined
                ? nodeText(verifiedShape, verifiedShape.hookNodeId) === plan.hook
                : false,
            urls: [...collectUrls(verifiedShape.nodes, plan.staticUrls)].every((u) => u === plan.url),
            tags: plan.templateTagId === undefined ||
                collectTagIds(verifiedShape).every((id) => id !== plan.templateTagId),
        };
        for (const widget of verifiedShape.widgets) {
            const widgetId = num(widget["widget_id"]);
            if (widgetId === undefined)
                continue;
            const loaded = await api.loadWidget(widgetId);
            const widgetObj = isRecord(loaded["widget"]) ? loaded["widget"] : loaded;
            const data = isRecord(widgetObj["data"]) ? widgetObj["data"] : {};
            const keywords = isRecord(data["feed_comment_settings"])
                ? data["feed_comment_settings"]["include_keywords_array"]
                : data["keywords"];
            checks[`widget:${widgetId}:keywords`] =
                Array.isArray(keywords) &&
                    keywords.length === plan.keywords.length &&
                    plan.keywords.every((k, i) => keywords[i] === k);
        }
        const failed = Object.entries(checks).filter(([, ok]) => ok !== true);
        result.verified = checks;
        if (failed.length > 0) {
            result.status = "failed";
            result.error = `verification failed: ${failed.map(([key]) => key).join(", ")}`;
            return result;
        }
        stages.push("verified");
        result.status = "deployed";
        return result;
    });
}
function nodeText(shape, contentId) {
    const node = shape.nodes.find((candidate) => candidate.content_id === contentId);
    const data = isRecord(node?.["data"]) ? node?.["data"] : undefined;
    const messages = data && Array.isArray(data["messages"]) ? data["messages"] : [];
    const first = messages.find(isRecord);
    const content = first && isRecord(first["content"]) ? first["content"] : undefined;
    return typeof content?.["text"] === "string" ? content["text"] : undefined;
}
function collectTagIds(shape) {
    const ids = [];
    for (const node of shape.nodes) {
        const data = isRecord(node["data"]) ? node["data"] : undefined;
        if (data && Array.isArray(data["actions"])) {
            for (const action of data["actions"]) {
                if (isRecord(action) && action["type"] === "add_tag") {
                    const id = num(action["tag_id"]);
                    if (id !== undefined)
                        ids.push(id);
                }
            }
        }
    }
    return ids;
}
