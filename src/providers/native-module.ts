import { createRequire } from "node:module";

import { hasGraphicalSession } from "../shell-environment.js";
import type { ClipboardImageProvider, ClipboardProviderContext, ClipboardReadResult } from "./types.js";
import type { ClipboardModule } from "../types.js";

const require = createRequire(import.meta.url);
let cachedClipboardModule: ClipboardModule | null | undefined;

export type ClipboardModuleLoader = (
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
) => ClipboardModule | null;

export function loadClipboardModule(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): ClipboardModule | null {
  if (cachedClipboardModule !== undefined) {
    return cachedClipboardModule;
  }

  if (environment.TERMUX_VERSION || !hasGraphicalSession(platform, environment)) {
    cachedClipboardModule = null;
    return cachedClipboardModule;
  }

  try {
    cachedClipboardModule = require("@mariozechner/clipboard") as ClipboardModule;
  } catch {
    cachedClipboardModule = null;
  }

  return cachedClipboardModule;
}

export interface NativeModuleProviderOptions {
  priority?: number;
  moduleLoader?: ClipboardModuleLoader;
}

export class NativeModuleProvider implements ClipboardImageProvider {
  readonly capabilities;
  private readonly moduleLoader: ClipboardModuleLoader;

  constructor(options: NativeModuleProviderOptions = {}) {
    this.capabilities = {
      id: "native-module",
      name: "@mariozechner/clipboard",
      platforms: "*" as const,
      priority: options.priority ?? 100,
    };
    this.moduleLoader = options.moduleLoader ?? loadClipboardModule;
  }

  isAvailable(context: ClipboardProviderContext): boolean {
    return this.moduleLoader(context.platform, context.environment) !== null;
  }

  async read(context: ClipboardProviderContext): Promise<ClipboardReadResult> {
    const clipboard = this.moduleLoader(context.platform, context.environment);
    if (!clipboard) {
      return { available: false, image: null };
    }

    if (!clipboard.hasImage()) {
      return { available: true, image: null };
    }

    const imageData = await clipboard.getImageBinary();
    if (!imageData || imageData.length === 0) {
      return { available: true, image: null };
    }

    const bytes = imageData instanceof Uint8Array ? imageData : Uint8Array.from(imageData);
    return {
      available: true,
      image: {
        bytes,
        mimeType: "image/png",
      },
    };
  }
}
