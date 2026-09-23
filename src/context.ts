import { resolveConfig, type ManyChatConfig } from "./lib/env.js";
import { createPublicApiClient, type PublicApiClient, type PublicApiDeps } from "./publicapi/client.js";

/**
 * Shared command context. Commands receive it lazily so `--help` and version
 * probing never construct a client. Tests construct their own with an
 * injected client implementation.
 */

export interface CommandContext {
  config: ManyChatConfig;
  client: PublicApiClient;
}

export function createCommandContext(deps: PublicApiDeps = {}): CommandContext {
  const config = resolveConfig();
  const client = createPublicApiClient(config, deps);
  return { config, client };
}

let cached: CommandContext | undefined;

export function getCommandContext(): CommandContext {
  cached ??= createCommandContext();
  return cached;
}
