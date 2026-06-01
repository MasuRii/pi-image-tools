import type {
  ClipboardImageProvider,
  ClipboardProviderContext,
  ClipboardReadResult,
} from "./types.js";
import type { ClipboardImage } from "../types.js";

export interface ClipboardProviderAttempt {
  providerId: string;
  available: boolean;
  imageFound: boolean;
  skipped: boolean;
}

export interface ClipboardProviderRegistryReadResult {
  image: ClipboardImage | null;
  attempts: ClipboardProviderAttempt[];
}

function supportsPlatform(provider: ClipboardImageProvider, platform: NodeJS.Platform): boolean {
  const { platforms } = provider.capabilities;
  return platforms === "*" || platforms.includes(platform);
}

function byPriority(left: ClipboardImageProvider, right: ClipboardImageProvider): number {
  return left.capabilities.priority - right.capabilities.priority;
}

export class ClipboardProviderRegistry {
  private readonly providers: ClipboardImageProvider[] = [];

  constructor(providers: readonly ClipboardImageProvider[] = []) {
    for (const provider of providers) {
      this.register(provider);
    }
  }

  register(provider: ClipboardImageProvider): this {
    this.providers.push(provider);
    return this;
  }

  getProviders(platform: NodeJS.Platform): ClipboardImageProvider[] {
    return this.providers.filter((provider) => supportsPlatform(provider, platform)).sort(byPriority);
  }

  async getEligible(context: ClipboardProviderContext): Promise<ClipboardImageProvider[]> {
    const eligible: ClipboardImageProvider[] = [];
    for (const provider of this.getProviders(context.platform)) {
      if (await provider.isAvailable(context)) {
        eligible.push(provider);
      }
    }

    return eligible;
  }

  async read(context: ClipboardProviderContext): Promise<ClipboardProviderRegistryReadResult> {
    const attempts: ClipboardProviderAttempt[] = [];

    for (const provider of this.getProviders(context.platform)) {
      const isAvailable = await provider.isAvailable(context);
      if (!isAvailable) {
        attempts.push({
          providerId: provider.capabilities.id,
          available: false,
          imageFound: false,
          skipped: true,
        });
        continue;
      }

      const result: ClipboardReadResult = await provider.read(context);
      attempts.push({
        providerId: provider.capabilities.id,
        available: result.available,
        imageFound: result.image !== null,
        skipped: false,
      });

      if (result.image) {
        return { image: result.image, attempts };
      }
    }

    return { image: null, attempts };
  }
}
