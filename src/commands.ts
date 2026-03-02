import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import type { PasteImageCommandHandlers } from "./types.js";

const SUBCOMMAND_CLIPBOARD = "clipboard";
const SUBCOMMAND_RECENT = "recent";

const ARGUMENT_COMPLETIONS = [
  {
    value: SUBCOMMAND_CLIPBOARD,
    label: SUBCOMMAND_CLIPBOARD,
    description: "Attach image from clipboard",
  },
  {
    value: SUBCOMMAND_RECENT,
    label: SUBCOMMAND_RECENT,
    description: "Open recent images picker and attach selected image",
  },
  {
    value: "help",
    label: "help",
    description: "Show usage",
  },
] as const;

function parseArgs(args: string): string[] {
  return args
    .trim()
    .split(/\s+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0);
}

function usageMessage(): string {
  return "Usage: /paste-image [clipboard|recent]";
}

export function registerPasteImageCommand(
  pi: ExtensionAPI,
  handlers: PasteImageCommandHandlers,
): void {
  pi.registerCommand("paste-image", {
    description: "Attach an image from clipboard or use a recent-image picker",
    getArgumentCompletions: (argumentPrefix) => {
      const normalized = argumentPrefix.trim().toLowerCase();
      if (!normalized) {
        return [...ARGUMENT_COMPLETIONS];
      }

      const matches = ARGUMENT_COMPLETIONS.filter((item) => item.value.startsWith(normalized));
      return matches.length > 0 ? matches.map((item) => ({ ...item })) : null;
    },
    handler: async (args, ctx) => {
      const tokens = parseArgs(args);

      if (tokens.length === 0 || tokens[0] === SUBCOMMAND_CLIPBOARD) {
        await handlers.fromClipboard(ctx);
        return;
      }

      if (tokens[0] === SUBCOMMAND_RECENT) {
        if (tokens.length > 1) {
          ctx.ui.notify(usageMessage(), "warning");
          return;
        }

        await handlers.fromRecent(ctx);
        return;
      }

      if (tokens[0] === "help") {
        ctx.ui.notify(usageMessage(), "info");
        return;
      }

      ctx.ui.notify(usageMessage(), "warning");
    },
  });
}
