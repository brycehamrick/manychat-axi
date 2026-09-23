import { resolveConfig } from "./lib/env.js";
import { createPublicApiClient } from "./publicapi/client.js";
export function createCommandContext(deps = {}) {
    const config = resolveConfig();
    const client = createPublicApiClient(config, deps);
    return { config, client };
}
let cached;
export function getCommandContext() {
    cached ??= createCommandContext();
    return cached;
}
