import { resolveConfig, type ManyChatConfig } from "./lib/env.js";
import { createPublicApiClient, type PublicApiClient, type PublicApiDeps } from "./publicapi/client.js";
import { resolveStateDir } from "./browser/session.js";
import { runDiscover, runLogin, runProbe, type RunnerDeps } from "./browser/runners.js";

/**
 * Shared command context. Commands receive it lazily so `--help` and version
 * probing never construct a client. Tests construct their own with an
 * injected public API client and browser runners.
 */

export interface BrowserRunners {
  login(opts: { stateDir: string; timeoutMs: number }): Promise<{ url: string }>;
  probe(opts: { stateDir: string }): Promise<{ state: string; url: string }>;
  discover(opts: {
    stateDir: string;
    url: string;
    loginTimeoutMs: number;
    maxWaitMs: number;
  }): Promise<{
    runDir: string;
    runId: string;
    url: string;
    exchanges: unknown[];
    documentCount: number;
    consoleErrors: string[];
    files: string[];
  }>;
}

export interface CommandContext {
  config: ManyChatConfig;
  client: PublicApiClient;
  stateDir: string;
  browser: BrowserRunners;
}

export function createCommandContext(deps: PublicApiDeps = {}, browserDeps?: RunnerDeps): CommandContext {
  const config = resolveConfig();
  const client = createPublicApiClient(config, deps);
  const stateDir = resolveStateDir();
  const runners: BrowserRunners = {
    login: (opts) => runLogin({ ...opts, deps: browserDeps }),
    probe: (opts) => runProbe({ ...opts, deps: browserDeps }),
    discover: (opts) => runDiscover({ ...opts, deps: browserDeps }),
  };
  return { config, client, stateDir, browser: runners };
}

let cached: CommandContext | undefined;

export function getCommandContext(): CommandContext {
  cached ??= createCommandContext();
  return cached;
}
