import { hasGraphicalSession, isWaylandSession } from "./shell-environment.js";
import { NativeModuleProvider } from "./providers/native-module.js";
import { OsascriptPngfProvider } from "./providers/mac-osascript-pngf.js";
import { OsascriptPublicPngProvider } from "./providers/mac-osascript-publicpng.js";
import { PngpasteProvider } from "./providers/mac-pngpaste.js";
import { PowerShellFormsProvider } from "./providers/powershell-forms.js";
import { ClipboardProviderRegistry } from "./providers/registry.js";
import { WlPasteProvider } from "./providers/wl-paste.js";
import { XclipProvider } from "./providers/xclip.js";
import type { ClipboardImage } from "./types.js";

export { hasGraphicalSession } from "./shell-environment.js";

export function buildDefaultClipboardProviderRegistry(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
): ClipboardProviderRegistry {
  const registry = new ClipboardProviderRegistry();

  if (platform === "win32") {
    registry
      .register(new NativeModuleProvider({ priority: 10 }))
      .register(new PowerShellFormsProvider({ priority: 20 }));
    return registry;
  }

  if (platform === "linux") {
    const waylandFirst = isWaylandSession(environment);
    registry
      .register(new WlPasteProvider({ priority: waylandFirst ? 10 : 20 }))
      .register(new XclipProvider({ priority: waylandFirst ? 20 : 10 }))
      .register(new NativeModuleProvider({ priority: 30 }));
    return registry;
  }

  if (platform === "darwin") {
    registry
      .register(new PngpasteProvider({ priority: 10 }))
      .register(new OsascriptPublicPngProvider({ priority: 20 }))
      .register(new OsascriptPngfProvider({ priority: 30 }))
      .register(new NativeModuleProvider({ priority: 40 }));
    return registry;
  }

  registry.register(new NativeModuleProvider({ priority: 100 }));
  return registry;
}

function getUnavailableReaderMessage(platform: NodeJS.Platform): string {
  switch (platform) {
    case "linux":
      return "No Linux clipboard image reader is available. Install wl-clipboard or xclip, or ensure @mariozechner/clipboard is installed.";
    case "darwin":
      return "No macOS clipboard image reader is available. Install pngpaste, ensure osascript is available, or ensure @mariozechner/clipboard is installed.";
    case "win32":
      return "No Windows clipboard image reader is available. Ensure PowerShell is available or @mariozechner/clipboard is installed.";
    default:
      return `Clipboard image paste is not supported on platform: ${platform}`;
  }
}

export async function readClipboardImage(options?: {
  environment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  registry?: ClipboardProviderRegistry;
}): Promise<ClipboardImage | null> {
  const environment = options?.environment ?? process.env;
  const platform = options?.platform ?? process.platform;

  if (environment.TERMUX_VERSION) {
    return null;
  }

  if (!hasGraphicalSession(platform, environment)) {
    throw new Error("Clipboard image paste requires a graphical desktop session with DISPLAY or WAYLAND_DISPLAY.");
  }

  const registry = options?.registry ?? buildDefaultClipboardProviderRegistry(platform, environment);
  const result = await registry.read({ platform, environment });
  if (result.image) {
    return result.image;
  }

  if (result.attempts.some((attempt) => attempt.available)) {
    return null;
  }

  throw new Error(getUnavailableReaderMessage(platform));
}
