import type { ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";

export type PasteContext = ExtensionContext | ExtensionCommandContext;

export interface ClipboardImage {
  bytes: Uint8Array;
  mimeType: string;
}

export interface ClipboardModule {
  hasImage: () => boolean;
  getImageBinary: () => Promise<Array<number> | Uint8Array>;
}

export type PasteImageHandler = (ctx: PasteContext) => Promise<void>;

export interface PasteImageCommandHandlers {
  fromClipboard: PasteImageHandler;
  fromRecent: PasteImageHandler;
}
