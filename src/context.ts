import { resolveConfig, type ManyChatConfig } from "./lib/env.js";
import { loadDotEnv, mergeEnv } from "./lib/dotenv.js";
import { createPublicApiClient, type PublicApiClient, type PublicApiDeps } from "./publicapi/client.js";
import { loadProjectConfig, type ProjectConfig } from "./config/projectConfig.js";
import { resolveStateDir } from "./browser/session.js";
import { runDiscover, runLogin, runProbe, type RunnerDeps } from "./browser/runners.js";
import { withAppApi, type AppApi, type AppApiOptions } from "./browser/appfetch.js";

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
  /** In-page app API: opens the session browser, runs fn, closes. */
  withApp<T>(opts: AppApiOptions, fn: (api: AppApi) => Promise<T>): Promise<T>;
}

export interface CommandContext {
  config: ManyChatConfig;
  client: PublicApiClient;
  stateDir: string;
  browser: BrowserRunners;
  projectConfig: ProjectConfig | null;
  /** Merged environment (process env + .env file) for per-account key lookup. */
  env: NodeJS.ProcessEnv;
  /** Public API client bound to a specific account's key. */
  publicClientFor(apiKey: string | undefined): PublicApiClient;
}

export function createCommandContext(deps: PublicApiDeps = {}, browserDeps?: RunnerDeps): CommandContext {
  const env = mergeEnv(loadDotEnv(), process.env);
  const config = resolveConfig(env);
  const client = createPublicApiClient(config, deps);
  const stateDir = resolveStateDir(env);
  const runners: BrowserRunners = {
    login: (opts) => runLogin({ ...opts, deps: browserDeps }),
    probe: (opts) => runProbe({ ...opts, deps: browserDeps }),
    discover: (opts) => runDiscover({ ...opts, deps: browserDeps }),
    withApp: (opts, fn) => withAppApi({ ...opts, deps: browserDeps?.appDeps }, fn),
  };
  return {
    config,
    client,
    stateDir,
    browser: runners,
    projectConfig: loadProjectConfig(),
    env,
    publicClientFor: (apiKey: string | undefined) =>
      createPublicApiClient({ apiKey, apiUrl: config.apiUrl }, deps),
  };
}

let cached: CommandContext | undefined;

export function getCommandContext(): CommandContext {
  cached ??= createCommandContext();
  return cached;
}
