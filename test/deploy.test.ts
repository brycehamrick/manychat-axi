import { describe, expect, it } from "vitest";
import fixtureJson from "./fixtures/flow-doc.json" with { type: "json" };
import type { AppApi } from "../src/browser/appfetch.js";
import type { PublicApiClient } from "../src/publicapi/client.js";
import type { DeploySpec } from "../src/template/spec.js";
import { parseSpec } from "../src/template/spec.js";
import {
  applyKeywordsToWidget,
  deployTarget,
  editNode,
  planTarget,
  readTemplateShape,
  toWriteShape,
  type DeployDeps,
  type TargetPlan,
  type TargetTemplateConfig,
} from "../src/template/deploy.js";

const fixtureDoc = fixtureJson as Record<string, unknown>;

const SPEC = parseSpec(
  `
version: 1
episode: 167
keyword: EP167
hook: "Endo symptoms shift in perimenopause - tap below!"
url: "https://drbrt.in/ep167"
tag: "Podcast | EP167 | Clicked"
targets: [podcast-fb]
`,
  "spec.yaml",
);

const TEMPLATE: TargetTemplateConfig = {
  template: "podcast-fb",
  ns: "content20260922154445_584682",
  kind: "podcast-fb",
  account: "brighten",
  page: "fb1071254",
  apiKey: "key-1",
  staticUrls: ["https://drbrighten.com/applepodcasts"],
};

interface AppCall {
  method: string;
  args: unknown[];
}

function fakeAppApi(opts: {
  newNs?: string;
  verifyHook?: string;
  verifyUrl?: string;
  keywords?: string[];
}): { api: AppApi; calls: AppCall[] } {
  const calls: AppCall[] = [];
  const record = (method: string) => (...args: unknown[]): unknown => {
    calls.push({ method, args });
    return args;
  };
  const newNs = opts.newNs ?? "content20990101000000_999999";
  const api: AppApi = {
    clientId: "client-1",
    csrfToken: "csrf-1",
    raw: async () => ({}),
    getInfo: async () => ({ id: 1, name: "x" }),
    getObject: async () => ({}),
    getFlowData: async (ns: string) => {
      calls.push({ method: "getFlowData", args: [ns] });
      if (ns === TEMPLATE.ns) return fixtureDoc;
      // Duplicate document: template shape with the deployed values applied.
      const doc = JSON.parse(JSON.stringify(fixtureDoc)) as Record<string, unknown>;
      const flow = doc["flow"] as Record<string, unknown>;
      flow["ns"] = ns;
      flow["name"] = "EP167 to DM FB";
      const contents = flow["contents"] as Array<Record<string, unknown>>;
      for (const node of contents) {
        const data = node["data"] as Record<string, unknown>;
        if (node["caption"] === "Send Message" && Array.isArray(data["messages"])) {
          const message = (data["messages"] as Array<Record<string, unknown>>)[0];
          if (message) {
            const content = message["content"] as Record<string, unknown>;
            content["text"] = opts.verifyHook ?? SPEC.hook;
          }
        }
        if (Array.isArray(data["messages"])) {
          for (const message of data["messages"] as Array<Record<string, unknown>>) {
            const keyboard = message["keyboard"];
            if (!Array.isArray(keyboard)) continue;
            for (const button of keyboard as Array<Record<string, unknown>>) {
              if (button["type"] === "url" && button["url"] !== "https://drbrighten.com/applepodcasts") {
                button["url"] = opts.verifyUrl ?? SPEC.url;
              }
            }
          }
        }
        if (Array.isArray(data["actions"])) {
          for (const action of data["actions"] as Array<Record<string, unknown>>) {
            if (action["type"] === "add_tag") action["tag_id"] = 888001;
          }
        }
      }
      return doc;
    },
    loadWidget: async (widgetId: number) => {
      calls.push({ method: "loadWidget", args: [widgetId] });
      return {
        widget: {
          widget_id: widgetId,
          widget_type: "feed_comment_trigger",
          status: "draft",
          data: {
            feed_comment_settings: {
              include_keywords_array: opts.keywords ?? SPEC.keywords,
              include_keywords: "x",
            },
          },
        },
      };
    },
    clone: async (path: string) => {
      calls.push({ method: "clone", args: [path] });
      return {
        fs_object: { path: `/23495021/27592482/${newNs}`, flow: { ns: newNs } },
      };
    },
    rename: async (path: string, title: string) => {
      calls.push({ method: "rename", args: [path, title] });
      return {};
    },
    patchDraft: async (ns: string, batch: Record<string, unknown>) => {
      calls.push({ method: "patchDraft", args: [ns, batch] });
      return {};
    },
    setWidget: async (widget: Record<string, unknown>) => {
      calls.push({ method: "setWidget", args: [widget] });
      return {};
    },
    setDraftStatus: async (widgetId: number, status: string) => {
      calls.push({ method: "setDraftStatus", args: [widgetId, status] });
      return {};
    },
    publishFlow: async (payload: Record<string, unknown>) => {
      calls.push({ method: "publishFlow", args: [payload] });
      return {};
    },
    createTag: async (name: string) => {
      calls.push({ method: "createTag", args: [name] });
      return { id: 888002, name };
    },
  };
  void record;
  return { api, calls };
}

function fakePublicClient(tags: Array<{ id: number; name: string }>, flows: Array<{ ns: string; name: string }> = []) {
  const calls: string[] = [];
  const client: PublicApiClient = {
    getInfo: async () => ({ id: 1, name: "p" }),
    getTags: async () => {
      calls.push("getTags");
      return tags;
    },
    createTag: async (name) => {
      calls.push(`createTag:${name}`);
      return { id: 888003, name };
    },
    getFlows: async () => {
      calls.push("getFlows");
      return {
        flows: flows.map((f) => ({ ns: f.ns, name: f.name, folderId: null })),
        folders: [],
      };
    },
    getCustomFields: async () => [],
    createCustomField: async () => ({ id: 1, name: "x", type: "text", description: null }),
    getBotFields: async () => [],
    createBotField: async () => ({ id: 2, name: "x", type: "text", description: null }),
  };
  return { client, calls };
}

function depsFor(app: AppApi, publicClient: PublicApiClient): DeployDeps {
  return {
    withApp: async (_opts, fn) => fn(app),
    publicClientFor: () => publicClient,
    stateDir: "/tmp/state",
  };
}

describe("readTemplateShape", () => {
  it("extracts hook, widgets, and the primary tag from a real document", () => {
    const shape = readTemplateShape(fixtureDoc);
    expect(shape.hookNodeId).toBe(1283736567);
    expect(shape.widgets).toHaveLength(1);
    expect(shape.widgets[0]?.widget_type).toBe("feed_comment_trigger");
    expect(shape.primaryTagId).toBe(97158079);
  });
});

describe("editNode", () => {
  const shape = readTemplateShape(fixtureDoc);
  const hookNode = shape.nodes.find((n) => n.content_id === shape.hookNodeId);
  const deliveryNode = shape.nodes.find((n) => n.caption === "Send Message #1");
  const tagNode = shape.nodes.find((n) => n.caption === "Actions #2");

  it("rewrites the hook text in write shape", () => {
    const edited = editNode(hookNode!, "ns-new", { hook: "NEW HOOK" }, [], shape.hookNodeId);
    const messages = (edited?.["messages"] as Array<Record<string, unknown>>)[0];
    const content = messages["content"] as Record<string, unknown>;
    expect(content["text"]).toBe("NEW HOOK");
    expect(edited?.["namespace"]).toBe("ns-new");
    expect(edited?.["content_id"]).toBe(hookNode!.content_id);
  });

  it("replaces non-static url buttons and leaves static ones alone", () => {
    const edited = editNode(
      deliveryNode!,
      "ns-new",
      { url: { replace: () => "https://new.example/ep" } },
      ["https://drbrighten.com/applepodcasts"],
    );
    const messages = edited?.["messages"] as Array<Record<string, unknown>>;
    const keyboard = (messages[0]?.["keyboard"] as Array<Record<string, unknown>>)[0];
    expect(keyboard["url"]).toBe("https://new.example/ep");
  });

  it("rewrites the primary add_tag id", () => {
    const edited = editNode(tagNode!, "ns-new", { tags: { from: 97158079, to: 42 } }, []);
    const actions = edited?.["actions"] as Array<Record<string, unknown>>;
    expect(actions[0]?.["tag_id"]).toBe(42);
  });

  it("returns undefined for untouched nodes", () => {
    expect(editNode(shape.nodes[0]!, "ns-new", {}, [])).toBeUndefined();
  });

  it("toWriteShape flattens data and drops stats", () => {
    const write = toWriteShape(hookNode!, "ns-new");
    expect(write["messages"]).toBeDefined();
    expect(write["stats"]).toBeUndefined();
    expect(write["sent_total"]).toBeUndefined();
  });
});

describe("applyKeywordsToWidget", () => {
  it("updates comment settings arrays and the joined string", () => {
    const widget = {
      widget_id: 1,
      data: { feed_comment_settings: { include_keywords_array: ["OLD"], include_keywords: "OLD" } },
    };
    const updated = applyKeywordsToWidget(widget, ["EP167", "EP 167"]);
    const settings = (updated["data"] as Record<string, unknown>)["feed_comment_settings"] as Record<string, unknown>;
    expect(settings["include_keywords_array"]).toEqual(["EP167", "EP 167"]);
    expect(settings["include_keywords"]).toBe("EP167,EP 167");
  });

  it("updates story widgets' keyword arrays", () => {
    const widget = { widget_id: 2, data: { keywords: ["OLD"] } };
    const updated = applyKeywordsToWidget(widget, ["EP167"]);
    expect((updated["data"] as Record<string, unknown>)["keywords"]).toEqual(["EP167"]);
  });
});

describe("planTarget", () => {
  it("builds the plan from live reads and flags name conflicts", async () => {
    const { api } = fakeAppApi({});
    const { client } = fakePublicClient(
      [{ id: 888001, name: "Podcast | EP167 | Clicked" }],
      [{ ns: "existing-1", name: "EP167 to DM FB" }],
    );
    const plan = await planTarget(SPEC, TEMPLATE, depsFor(api, client));
    expect(plan.name).toBe("EP167 to DM FB");
    expect(plan.tagId).toBe(888001);
    expect(plan.templateTagId).toBe(97158079);
    expect(plan.conflict).toEqual({ ns: "existing-1", name: "EP167 to DM FB" });
  });
});

describe("deployTarget", () => {
  it("executes clone -> rename -> patch -> setWidget -> verify and never publishes", async () => {
    const { api, calls } = fakeAppApi({});
    const { client } = fakePublicClient([{ id: 888001, name: "Podcast | EP167 | Clicked" }]);
    const result = await deployTarget(
      { ...(await planTarget(SPEC, TEMPLATE, depsFor(api, client))), conflict: undefined },
      SPEC,
      depsFor(api, client),
      TEMPLATE,
    );

    expect(result.status).toBe("deployed");
    expect(result.ns).toBe("content20990101000000_999999");
    const methods = calls.map((call) => call.method);
    expect(methods.indexOf("clone")).toBeLessThan(methods.indexOf("rename"));
    expect(methods.indexOf("rename")).toBeLessThan(methods.indexOf("patchDraft"));
    expect(methods.indexOf("patchDraft")).toBeLessThan(methods.indexOf("setWidget"));
    expect(methods).not.toContain("publishFlow");
    expect(methods).not.toContain("setDraftStatus");

    const patch = calls.find((call) => call.method === "patchDraft");
    const batch = patch?.args[1] as { contents: Array<Record<string, unknown>> };
    expect(batch.contents.length).toBeGreaterThanOrEqual(3);
    const hook = batch.contents.find((c) => c["caption"] === "Send Message");
    const hookMessage = (hook?.["messages"] as Array<Record<string, unknown>>)[0];
    expect((hookMessage["content"] as Record<string, unknown>)["text"]).toBe(SPEC.hook);
    const tagNode = batch.contents.find((c) => c["caption"] === "Actions #2");
    expect(((tagNode?.["actions"] as Array<Record<string, unknown>>)[0])["tag_id"]).toBe(888001);
  });

  it("creates the tag when missing via the account's public client", async () => {
    const { api, calls } = fakeAppApi({});
    const { client, calls: pub } = fakePublicClient([]);
    const plan = await planTarget(SPEC, TEMPLATE, depsFor(api, client));
    const result = await deployTarget(plan, SPEC, depsFor(api, client), TEMPLATE);
    expect(result.status).toBe("deployed");
    expect(pub).toContain("createTag:Podcast | EP167 | Clicked");
    void calls;
  });

  it("reports verification failures without throwing", async () => {
    const { api } = fakeAppApi({ verifyHook: "WRONG TEXT WENT LIVE" });
    const { client } = fakePublicClient([{ id: 888001, name: "Podcast | EP167 | Clicked" }]);
    const plan = await planTarget(SPEC, TEMPLATE, depsFor(api, client));
    const result = await deployTarget(plan, SPEC, depsFor(api, client), TEMPLATE);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("verification failed");
    expect(result.verified?.["hook"]).toBe(false);
  });

  it("refuses to clone when a flow with the target name exists", async () => {
    const { api, calls } = fakeAppApi({});
    const { client } = fakePublicClient(
      [{ id: 888001, name: "Podcast | EP167 | Clicked" }],
      [{ ns: "existing-1", name: "EP167 to DM FB" }],
    );
    const plan = await planTarget(SPEC, TEMPLATE, depsFor(api, client));
    await expect(deployTarget(plan, SPEC, depsFor(api, client), TEMPLATE)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("already exists"),
    });
    expect(calls.filter((call) => call.method === "clone")).toHaveLength(0);
  });
});

describe("TargetPlan type smoke", () => {
  it("carries the fields the command renders", async () => {
    const { api } = fakeAppApi({});
    const { client } = fakePublicClient([]);
    const plan: TargetPlan = await planTarget(SPEC, TEMPLATE, depsFor(api, client));
    expect(plan.template).toBe("podcast-fb");
    expect(plan.url).toBe(SPEC.url);
    expect(plan.tagId).toBeUndefined();
  });
});
