import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { KeyId } from "@mariozechner/pi-tui";

import type { PasteImageHandler } from "./types.js";

function getImagePasteShortcuts(platform: NodeJS.Platform = process.platform): KeyId[] {
  if (platform === "win32") {
    return ["alt+v", "ctrl+alt+v"];
  }

  return ["ctrl+v", "alt+v", "ctrl+alt+v"];
}

export function registerImagePasteKeybindings(pi: ExtensionAPI, handler: PasteImageHandler): void {
  for (const shortcut of getImagePasteShortcuts()) {
    pi.registerShortcut(shortcut, {
      description: "Attach clipboard image to draft (send when ready)",
      handler,
    });
  }
}
