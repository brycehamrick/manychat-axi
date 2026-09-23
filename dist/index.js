import { runAxiCli } from "axi-sdk-js";
import { VERSION } from "./version.js";
import { getCommandContext } from "./context.js";
import { homeCommand } from "./commands/home.js";
import { authCommand, AUTH_HELP } from "./commands/auth.js";
import { flowsCommand, FLOWS_HELP } from "./commands/flows.js";
import { tagsCommand, TAGS_HELP } from "./commands/tags.js";
import { fieldsCommand, FIELDS_HELP } from "./commands/fields.js";
import { setupCommand, SETUP_HELP } from "./commands/setup.js";
export const DESCRIPTION = "ManyChat for agents - automation inventory, tags, and fields over the public API (browser-session flow editing arrives in later phases)";
const TOP_LEVEL_HELP = `manychat-axi - ${DESCRIPTION}

commands:
  auth status            check the public API key and browser transport state
  flows list             automation inventory (ns, name, folder)
  tags list              all tags
  tags ensure <name>     create a tag if missing (idempotent; --confirm to create)
  fields list            custom user fields and bot fields
  fields ensure <name>   create a field if missing (--type required, idempotent, --confirm to create)
  setup hooks|status     install ambient session context

global flags: --help, -v/--version, update (self-update)

auth: MANYCHAT_API_KEY env var (ManyChat Settings -> API, paid plans).
MANYCHAT_API_URL optionally overrides https://api.manychat.com.

roadmap: flow content (flows get/pull/diff/push, flow publish, template
deploy) needs the browser transport - Phase 1 and later; see the README.

run \`manychat-axi <command> --help\` for a command reference.`;
const COMMAND_HELP = {
    auth: { help: AUTH_HELP },
    flows: { help: FLOWS_HELP },
    tags: { help: TAGS_HELP },
    fields: { help: FIELDS_HELP },
    setup: { help: SETUP_HELP },
};
function withContext(command) {
    return (args) => command(args, getCommandContext());
}
export async function main() {
    await runAxiCli({
        description: DESCRIPTION,
        version: VERSION,
        topLevelHelp: TOP_LEVEL_HELP,
        getCommandHelp: (command) => COMMAND_HELP[command]?.help ?? null,
        home: withContext(homeCommand),
        commands: {
            auth: withContext(authCommand),
            flows: withContext(flowsCommand),
            tags: withContext(tagsCommand),
            fields: withContext(fieldsCommand),
            setup: (args) => setupCommand(args),
        },
    });
}
// Direct execution (node dist/index.js) instead of the bin wrapper.
if (process.argv[1]?.endsWith("index.js")) {
    await main();
}
