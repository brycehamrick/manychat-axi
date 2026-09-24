import { describe, expect, it } from "vitest";
import { AxiError } from "axi-sdk-js";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PublicApiClient, CreateFieldInput } from "../src/publicapi/client.js";
import type { CommandContext, BrowserRunners } from "../src/context.js";
import type { ProjectConfig } from "../src/config/projectConfig.js";
import { parseProjectConfig } from "../src/config/projectConfig.js";
import { homeCommand } from "../src/commands/home.js";
import { authCommand } from "../src/commands/auth.js";
import { flowsCommand } from "../src/commands/flows.js";
import { tagsCommand } from "../src/commands/tags.js";
import { fieldsCommand } from "../src/commands/fields.js";
import { discoverCommand } from "../src/commands/discover.js";
import fixtureJson from "./fixtures/flow-doc.json" with { type: "json" };

const fixtureDoc = fixtureJson as Record<string, unknown>;

const API_KEY = "secret-test-key-0123456789abcdef";

function tempStateDir(): string {
  return mkdtempSync(join(tmpdir(), "manychat-axi-test-"));
}

interface FakeImpl {
  getInfo?: () => unknown;
  getTags?: () => unknown;
  createTag?: (name: string) => unknown;
  getFlows?: () => unknown;
  getCustomFields?: () => unknown;
  createCustomField?: (input: CreateFieldInput) => unknown;
  getBotFields?: () => unknown;
  createBotField?: (input: CreateFieldInput) => unknown;
}

function contextFor(
  impl: FakeImpl = {},
  apiKey: string = API_KEY,
  browser: Partial<BrowserRunners> = {},
  projectConfig: ProjectConfig | null = null,
): { ctx: CommandContext; calls: string[] } {
  const calls: string[] = [];
  const resolvedKey = apiKey || undefined;
  const unexpected = (name: string): never => {
    throw new Error(`unexpected client call: ${name}`);
  };
  const client: PublicApiClient = {
    getInfo: async () => {
      calls.push("getInfo");
      return impl.getInfo ? impl.getInfo() : unexpected("getInfo");
    },
    getTags: async () => {
      calls.push("getTags");
      return impl.getTags ? impl.getTags() : unexpected("getTags");
    },
    createTag: async (name) => {
      calls.push(`createTag:${name}`);
      return impl.createTag ? impl.createTag(name) : unexpected("createTag");
    },
    getFlows: async () => {
      calls.push("getFlows");
      return impl.getFlows ? impl.getFlows() : unexpected("getFlows");
    },
    getCustomFields: async () => {
      calls.push("getCustomFields");
      return impl.getCustomFields ? impl.getCustomFields() : unexpected("getCustomFields");
    },
    createCustomField: async (input) => {
      calls.push("createCustomField");
      return impl.createCustomField ? impl.createCustomField(input) : unexpected("createCustomField");
    },
    getBotFields: async () => {
      calls.push("getBotFields");
      return impl.getBotFields ? impl.getBotFields() : unexpected("getBotFields");
    },
    createBotField: async (input) => {
      calls.push("createBotField");
      return impl.createBotField ? impl.createBotField(input) : unexpected("createBotField");
    },
  };
  return {
    ctx: {
      config: { apiKey: resolvedKey, apiUrl: "https://api.manychat.com/" },
      client,
      stateDir: tempStateDir(),
      projectConfig,
      env: resolvedKey ? { MANYCHAT_API_KEY: resolvedKey } : {},
      browser: {
        login: async () => {
          throw new Error("unexpected browser login");
        },
        probe: async () => {
          throw new Error("unexpected browser probe");
        },
        discover: async () => {
          throw new Error("unexpected browser discover");
        },
        withApp: async () => {
          throw new Error("unexpected browser withApp");
        },
        ...browser,
      },
    },
    calls,
  };
}

const PROJECT_CONFIG_TEXT = `
version: 1
defaultAccount: brighten
accounts:
  brighten:
    page: fb1071254
  show:
    page: fb2099
templates:
  podcast-fb:
    account: brighten
    ns: content20260922154445_584682
`;

function testProjectConfig(): ProjectConfig {
  return parseProjectConfig(PROJECT_CONFIG_TEXT, "test-config");
}

function page() {
  return { id: 12345, name: "Dr. Brighten" };
}

function inventory() {
  return {
    flows: [
      { ns: "ns-2", name: "Podcast | EP166", folderId: 7 },
      { ns: "ns-1", name: "Welcome Flow", folderId: null },
      { ns: "ns-3", name: "Podcast | EP170", folderId: 7 },
    ],
    folders: [{ id: 7, name: "Podcast", parentId: null }],
  };
}

describe("home", () => {
  it("makes zero client calls and explains setup without a key", async () => {
    const { ctx, calls } = contextFor({}, "");
    const out = (await homeCommand([], ctx)) as Record<string, unknown>;
    expect(calls).toEqual([]);
    expect((out["auth"] as Record<string, unknown>)["api_key"]).toBe("missing");
    const help = out["help"] as string[];
    expect(help).toEqual(expect.arrayContaining([expect.stringContaining("MANYCHAT_API_KEY")]));
  });

  it("shows the page and pre-computed counts with a working key", async () => {
    const { ctx, calls } = contextFor({
      getInfo: page,
      getFlows: inventory,
      getTags: () => [{ id: 1, name: "Clicked" }],
      getCustomFields: () => [],
      getBotFields: () => [{ id: 2, name: "season", type: "number", description: null }],
    });
    const out = (await homeCommand([], ctx)) as Record<string, unknown>;
    expect(calls).toEqual(["getInfo", "getFlows", "getTags", "getCustomFields", "getBotFields"]);
    expect(out["page"]).toEqual({ name: "Dr. Brighten", id: 12345 });
    expect(out["counts"]).toEqual({
      flows: 3,
      folders: 1,
      tags: 1,
      user_fields: 0,
      bot_fields: 1,
    });
  });

  it("short-circuits to an auth report when the key is rejected", async () => {
    const { ctx, calls } = contextFor({
      getInfo: () => {
        throw new AxiError(`ManyChat API rejected the API key (bad ${API_KEY})`, "AUTH_ERROR");
      },
    });
    const out = (await homeCommand([], ctx)) as Record<string, unknown>;
    expect(calls).toEqual(["getInfo"]);
    const auth = out["auth"] as Record<string, unknown>;
    expect(String(auth["api_key"])).toContain("not working");
    expect(JSON.stringify(out)).not.toContain(API_KEY);
  });
});

describe("auth status", () => {
  it("reports the unconfigured state without any client call", async () => {
    const { ctx, calls } = contextFor({}, "");
    const out = (await authCommand(["status"], ctx)) as Record<string, unknown>;
    expect(calls).toEqual([]);
    const auth = out["auth"] as Record<string, unknown>;
    expect((auth["api_key"] as Record<string, unknown>)["configured"]).toBe(false);
  });

  it("reports the page when the key works", async () => {
    const { ctx } = contextFor({ getInfo: page });
    const out = (await authCommand(["status"], ctx)) as Record<string, unknown>;
    const auth = out["auth"] as Record<string, unknown>;
    expect((auth["api_key"] as Record<string, unknown>)["valid"]).toBe(true);
    expect((auth["api_key"] as Record<string, unknown>)["page"]).toBe("Dr. Brighten");
  });

  it("reports invalid keys with a redacted error", async () => {
    const { ctx } = contextFor({
      getInfo: () => {
        throw new AxiError(`rejected (token ${API_KEY})`, "AUTH_ERROR");
      },
    });
    const out = (await authCommand(["status"], ctx)) as Record<string, unknown>;
    const auth = out["auth"] as Record<string, unknown>;
    const apiKey = auth["api_key"] as Record<string, unknown>;
    expect(apiKey["valid"]).toBe(false);
    expect(JSON.stringify(out)).not.toContain(API_KEY);
  });

  it("fails loud on unknown subcommands", async () => {
    const { ctx } = contextFor();
    await expect(authCommand(["bogus"], ctx)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("bogus"),
    });
  });
});

describe("auth login", () => {
  it("delegates to the browser runner with the default timeout", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const { ctx } = contextFor(
      {},
      API_KEY,
      {
        login: async (opts) => {
          seen.push(opts);
          return { url: "https://app.manychat.com/#/dashboard" };
        },
      },
    );
    const out = (await authCommand(["login"], ctx)) as Record<string, unknown>;
    const auth = out["auth"] as Record<string, unknown>;
    expect((auth["browser_session"] as Record<string, unknown>)["logged_in"]).toBe(true);
    expect(seen[0]?.["timeoutMs"]).toBe(300_000);
  });

  it("passes --timeout through", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const { ctx } = contextFor(
      {},
      API_KEY,
      {
        login: async (opts) => {
          seen.push(opts);
          return { url: "https://app.manychat.com/" };
        },
      },
    );
    await authCommand(["login", "--timeout", "600000"], ctx);
    expect(seen[0]?.["timeoutMs"]).toBe(600_000);
  });

  it("rejects timeouts outside the allowed range", async () => {
    const { ctx } = contextFor();
    await expect(authCommand(["login", "--timeout", "5000"], ctx)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

describe("auth logout", () => {
  it("deletes the session record and keeps the profile by default", async () => {
    const { ctx } = contextFor();
    mkdirSync(join(ctx.stateDir, "browser-profile"), { recursive: true });
    writeFileSync(join(ctx.stateDir, "session.json"), '{"lastLogin":"x","url":"y"}', "utf8");
    const out = (await authCommand(["logout"], ctx)) as Record<string, unknown>;
    const session = ((out["auth"] as Record<string, unknown>)["browser_session"]) as Record<
      string,
      unknown
    >;
    expect(session["session_record"]).toBe("deleted");
    expect(String(session["profile"])).toContain("--purge");
  });

  it("purges the profile with --purge", async () => {
    const { ctx } = contextFor();
    const profile = join(ctx.stateDir, "browser-profile");
    mkdirSync(profile, { recursive: true });
    writeFileSync(join(profile, "Cookies"), "fake", "utf8");
    const out = (await authCommand(["logout", "--purge"], ctx)) as Record<string, unknown>;
    const session = ((out["auth"] as Record<string, unknown>)["browser_session"]) as Record<
      string,
      unknown
    >;
    expect(session["profile"]).toBe("deleted");
    expect(existsSync(profile)).toBe(false);
  });
});

describe("auth status --browser", () => {
  it("surfaces the live probe result", async () => {
    const { ctx } = contextFor({ getInfo: page }, API_KEY, {
      probe: async () => ({ state: "logged-in", url: "https://app.manychat.com/#/dashboard" }),
    });
    const out = (await authCommand(["status", "--browser"], ctx)) as Record<string, unknown>;
    const auth = out["auth"] as Record<string, unknown>;
    const browser = auth["browser_session"] as Record<string, unknown>;
    expect((browser["live"] as Record<string, unknown>)["state"]).toBe("logged-in");
  });

  it("reports probe failures inline without crashing", async () => {
    const { ctx } = contextFor({ getInfo: page }, API_KEY, {
      probe: async () => {
        throw new AxiError("no usable Chrome/Chromium found", "LAUNCH_ERROR");
      },
    });
    const out = (await authCommand(["status", "--browser"], ctx)) as Record<string, unknown>;
    const auth = out["auth"] as Record<string, unknown>;
    const browser = auth["browser_session"] as Record<string, unknown>;
    expect(String((browser["live"] as Record<string, unknown>)["error"])).toContain("Chrome");
  });
});

describe("discover", () => {
  function discoverOutcome() {
    return {
      runDir: "/tmp/runs/discover-x",
      runId: "discover-x",
      url: "https://app.manychat.com/",
      exchanges: [{ index: 0, url: "u", method: "GET", status: 200 }],
      documentCount: 2,
      consoleErrors: ["e1"],
      files: ["trace.zip", "network.json", "index.json"],
    };
  }

  it("delegates with defaults and shapes the summary", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const { ctx } = contextFor({}, API_KEY, {
      discover: async (opts) => {
        seen.push(opts);
        return discoverOutcome();
      },
    });
    const out = (await discoverCommand([], ctx)) as Record<string, unknown>;
    expect(seen[0]?.["url"]).toBe("https://app.manychat.com/");
    expect(seen[0]?.["loginTimeoutMs"]).toBe(300_000);
    expect(out["discover"]).toMatchObject({
      run: "/tmp/runs/discover-x",
      network: { exchanges: 1, documents: 2, console_errors: 1 },
    });
  });

  it("rejects non-ManyChat URLs", async () => {
    const { ctx } = contextFor();
    await expect(discoverCommand(["--url", "https://example.com"], ctx)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("rejects malformed URLs", async () => {
    const { ctx } = contextFor();
    await expect(discoverCommand(["--url", "not-a-url"], ctx)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("requires an API key before launching", async () => {
    let launched = false;
    const { ctx, calls } = contextFor(
      {},
      "",
      {
        discover: async () => {
          launched = true;
          return discoverOutcome();
        },
      },
    );
    await expect(discoverCommand([], ctx)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(launched).toBe(false);
    expect(calls).toEqual([]);
  });

  it("rejects unknown flags", async () => {
    const { ctx } = contextFor();
    await expect(discoverCommand(["--nope"], ctx)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

describe("flows list", () => {
  it("renders sorted minimal-schema rows with folder names", async () => {
    const { ctx } = contextFor({ getFlows: inventory });
    const out = (await flowsCommand(["list"], ctx)) as Record<string, unknown>;
    expect(out["flows"]).toEqual({ count: 3, folders: 1 });
    expect(out["list"]).toEqual([
      { ns: "ns-2", name: "Podcast | EP166", folder: "Podcast" },
      { ns: "ns-3", name: "Podcast | EP170", folder: "Podcast" },
      { ns: "ns-1", name: "Welcome Flow", folder: "-" },
    ]);
  });

  it("filters by folder case-insensitively", async () => {
    const { ctx } = contextFor({ getFlows: inventory });
    const out = (await flowsCommand(["list", "--folder", "podcast"], ctx)) as Record<string, unknown>;
    expect(out["flows"]).toEqual({ count: 2, folder: "podcast" });
    const list = out["list"] as Array<Record<string, unknown>>;
    expect(list.every((row) => row["folder"] === "Podcast")).toBe(true);
  });

  it("produces definitive empty states", async () => {
    const { ctx } = contextFor({ getFlows: () => ({ flows: [], folders: [] }) });
    const out = (await flowsCommand(["list"], ctx)) as Record<string, unknown>;
    expect(out["result"]).toBe("0 flows");

    const filtered = (await flowsCommand(["list", "--folder", "Nothing"], ctx)) as Record<string, unknown>;
    expect(filtered["result"]).toBe('0 flows in folder "Nothing"');
  });

  it("fails loud on unimplemented content subcommands", async () => {
    const { ctx } = contextFor({ getFlows: inventory });
    const error = await flowsCommand(["pull"], ctx).catch((error: unknown) => error as AxiError);
    expect(error).toBeInstanceOf(AxiError);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.message).toContain("pull");
  });

  it("requires an API key before any client call", async () => {
    const { ctx, calls } = contextFor({ getFlows: inventory }, "");
    await expect(flowsCommand(["list"], ctx)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(calls).toEqual([]);
  });

  it("rejects unknown flags as VALIDATION_ERROR", async () => {
    const { ctx } = contextFor({ getFlows: inventory });
    await expect(flowsCommand(["list", "--nope"], ctx)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

describe("flows get", () => {
  function withAppReturning(doc: Record<string, unknown>) {
    const seen: Array<{ page: string; stateDir: string }> = [];
    return {
      seen,
      runner: async (
        opts: { page: string; stateDir: string },
        fn: (api: unknown) => Promise<unknown>,
      ) => {
        seen.push({ page: opts.page, stateDir: opts.stateDir });
        return fn({
          getFlowData: async () => doc,
        });
      },
    };
  }

  it("reads the flow through the app API and summarizes it", async () => {
    const { runner, seen } = withAppReturning(fixtureDoc);
    const { ctx } = contextFor({}, API_KEY, { withApp: runner }, testProjectConfig());
    const out = (await flowsCommand(["get", "content20260922154445_584682"], ctx)) as Record<
      string,
      unknown
    >;
    expect(seen[0]?.page).toBe("fb1071254");
    expect(out["account"]).toBe("brighten");
    const flow = out["flow"] as Record<string, unknown>;
    expect(flow["name"]).toBe("EP166 to DM FB");
    expect(flow["nodes"]).toBe(6);
    const triggers = out["triggers"] as Array<Record<string, unknown>>;
    expect(triggers[0]?.["keywords"]).toEqual(["EP166", "EP 166"]);
    const contents = out["contents"] as Array<Record<string, unknown>>;
    expect(contents).toHaveLength(6);
  });

  it("selects the account from config and --account", async () => {
    const { runner, seen } = withAppReturning(fixtureDoc);
    const { ctx } = contextFor({}, API_KEY, { withApp: runner }, testProjectConfig());
    await flowsCommand(["get", "ns-x", "--account", "show"], ctx);
    expect(seen[0]?.page).toBe("fb2099");
  });

  it("fails with setup guidance when no config exists", async () => {
    const { ctx } = contextFor({}, API_KEY);
    await expect(flowsCommand(["get", "ns-x"], ctx)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("config.yaml"),
    });
  });

  it("rejects unknown accounts", async () => {
    const { ctx } = contextFor({}, API_KEY, {}, testProjectConfig());
    await expect(flowsCommand(["get", "ns-x", "--account", "nope"], ctx)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

describe("tags", () => {
  it("lists tags with a definitive empty state", async () => {
    const { ctx } = contextFor({ getTags: () => [] });
    const out = (await tagsCommand(["list"], ctx)) as Record<string, unknown>;
    expect(out["result"]).toBe("0 tags");
  });

  it("ensure reports an exact match without mutating", async () => {
    const { ctx, calls } = contextFor({
      getTags: () => [{ id: 11, name: "Podcast | EP166 | Clicked" }],
    });
    const out = (await tagsCommand(["ensure", "Podcast | EP166 | Clicked"], ctx)) as Record<string, unknown>;
    expect(out["action"]).toBe("none");
    expect(calls).toEqual(["getTags"]);
  });

  it("ensure stops on a case-insensitive near-duplicate", async () => {
    const { ctx, calls } = contextFor({
      getTags: () => [{ id: 11, name: "clicked" }],
    });
    await expect(tagsCommand(["ensure", "Clicked", "--confirm"], ctx)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(calls).toEqual(["getTags"]);
  });

  it("ensure without --confirm previews and creates nothing", async () => {
    const { ctx, calls } = contextFor({ getTags: () => [] });
    const error = await tagsCommand(["ensure", "New Tag"], ctx).catch((error: unknown) => error as AxiError);
    expect(error).toBeInstanceOf(AxiError);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.message).toContain("--confirm");
    expect(calls).toEqual(["getTags"]);
  });

  it("ensure with --confirm creates the missing tag", async () => {
    const { ctx, calls } = contextFor({
      getTags: () => [],
      createTag: (name) => ({ id: 99, name }),
    });
    const out = (await tagsCommand(["ensure", "New Tag", "--confirm"], ctx)) as Record<string, unknown>;
    expect(out["action"]).toBe("created");
    expect(calls).toEqual(["getTags", "createTag:New Tag"]);
  });

  it("ensure rejects extra positionals", async () => {
    const { ctx } = contextFor({ getTags: () => [] });
    await expect(tagsCommand(["ensure", "A", "B"], ctx)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

describe("fields", () => {
  it("lists both scopes with aggregates by default", async () => {
    const { ctx, calls } = contextFor({
      getCustomFields: () => [{ id: 1, name: "episode", type: "text", description: null }],
      getBotFields: () => [],
    });
    const out = (await fieldsCommand(["list"], ctx)) as Record<string, unknown>;
    expect(out["fields"]).toEqual({ count: 1, user: 1, bot: 0 });
    expect(calls).toEqual(["getCustomFields", "getBotFields"]);
  });

  it("scope bot lists only bot fields", async () => {
    const { ctx, calls } = contextFor({ getBotFields: () => [] });
    const out = (await fieldsCommand(["list", "--scope", "bot"], ctx)) as Record<string, unknown>;
    expect(out["fields"]).toEqual({ count: 0, scope: "bot" });
    expect(calls).toEqual(["getBotFields"]);
  });

  it("ensure requires --type before any client call", async () => {
    const { ctx, calls } = contextFor({ getCustomFields: () => [] });
    await expect(fieldsCommand(["ensure", "episode"], ctx)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(calls).toEqual([]);
  });

  it("ensure rejects invalid types", async () => {
    const { ctx, calls } = contextFor({ getCustomFields: () => [] });
    await expect(
      fieldsCommand(["ensure", "episode", "--type", "string"], ctx),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(calls).toEqual([]);
  });

  it("ensure reports an exact same-type match without mutating", async () => {
    const { ctx, calls } = contextFor({
      getCustomFields: () => [{ id: 3, name: "episode", type: "text", description: null }],
    });
    const out = (await fieldsCommand(["ensure", "episode", "--type", "text"], ctx)) as Record<
      string,
      unknown
    >;
    expect(out["action"]).toBe("none");
    expect(calls).toEqual(["getCustomFields"]);
  });

  it("ensure stops when the existing field has a different type", async () => {
    const { ctx, calls } = contextFor({
      getCustomFields: () => [{ id: 3, name: "episode", type: "number", description: null }],
    });
    await expect(
      fieldsCommand(["ensure", "episode", "--type", "text", "--confirm"], ctx),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(calls).toEqual(["getCustomFields"]);
  });

  it("ensure without --confirm previews and creates nothing", async () => {
    const { ctx, calls } = contextFor({ getCustomFields: () => [] });
    const error = await fieldsCommand(
      ["ensure", "episode", "--type", "text"],
      ctx,
    ).catch((error: unknown) => error as AxiError);
    expect(error).toBeInstanceOf(AxiError);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(calls).toEqual(["getCustomFields"]);
  });

  it("ensure with --confirm creates in the requested scope", async () => {
    const { ctx, calls } = contextFor({
      getBotFields: () => [],
      createBotField: (input) => ({ id: 8, name: input.caption, type: input.type, description: null }),
    });
    const out = (await fieldsCommand(
      ["ensure", "season", "--type", "number", "--scope", "bot", "--confirm"],
      ctx,
    )) as Record<string, unknown>;
    expect(out["action"]).toBe("created");
    expect(out["field"]).toEqual({ scope: "bot", id: 8, name: "season", type: "number" });
    expect(calls).toEqual(["getBotFields", "createBotField"]);
  });
});
