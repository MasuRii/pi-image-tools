import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { KeyId } from "@mariozechner/pi-tui";

import type { PasteImageHandler } from "./types.js";

const IMAGE_PASTE_SHORTCUTS: KeyId[] = ["alt+v", "ctrl+alt+v"];

export function registerImagePasteKeybindings(pi: ExtensionAPI, handler: PasteImageHandler): void {
  for (const shortcut of IMAGE_PASTE_SHORTCUTS) {
    pi.registerShortcut(shortcut, {
      description: "Attach clipboard image to draft (send when ready)",
      handler,
    });
  }
}
