import type { ClipboardImage } from "../types.js";

export interface ClipboardReadResult {
  available: boolean;
  image: ClipboardImage | null;
}

export interface ClipboardProviderContext {
  platform: NodeJS.Platform;
  environment: NodeJS.ProcessEnv;
}

export interface ProviderCapabilities {
  readonly id: string;
  readonly name: string;
  readonly platforms: readonly NodeJS.Platform[] | "*";
  readonly priority: number;
}

export interface ClipboardImageProvider {
  readonly capabilities: ProviderCapabilities;
  isAvailable(context: ClipboardProviderContext): boolean | Promise<boolean>;
  read(context: ClipboardProviderContext): ClipboardReadResult | Promise<ClipboardReadResult>;
}
