import { buildNamespaceWrappedCommand, defaultCommandExists, type CommandExists } from "../shell-environment.js";
import {
  defaultCommandRunner,
  MAX_BUFFER_BYTES,
  READ_TIMEOUT_MS,
  type CommandRunner,
} from "./command-runner.js";
import type { ClipboardImageProvider, ClipboardProviderContext, ClipboardReadResult } from "./types.js";

const PNGF_SCRIPT = `try
  set imageData to the clipboard as «class PNGf»
  return imageData
on error
  return ""
end try`;

export interface OsascriptPngfProviderOptions {
  priority?: number;
  commandRunner?: CommandRunner;
  commandExists?: CommandExists;
}

function parseAppleScriptPngfData(stdout: Buffer): Uint8Array | null {
  const text = stdout.toString("utf8").trim();
  if (text.length === 0) {
    return null;
  }

  const match = text.match(/«data\s+PNGf([0-9a-fA-F\s]+)»/i);
  if (!match) {
    return null;
  }

  const hex = match[1]?.replace(/\s+/g, "") ?? "";
  if (hex.length === 0 || hex.length % 2 !== 0) {
    return null;
  }

  const bytes = Buffer.from(hex, "hex");
  return bytes.length > 0 ? new Uint8Array(bytes) : null;
}

export class OsascriptPngfProvider implements ClipboardImageProvider {
  readonly capabilities;
  private readonly commandRunner: CommandRunner;
  private readonly commandExists: CommandExists;

  constructor(options: OsascriptPngfProviderOptions = {}) {
    this.capabilities = {
      id: "mac-osascript-pngf",
      name: "osascript PNGf",
      platforms: ["darwin"],
      priority: options.priority ?? 30,
    };
    this.commandRunner = options.commandRunner ?? defaultCommandRunner;
    this.commandExists = options.commandExists ?? defaultCommandExists;
  }

  isAvailable(context: ClipboardProviderContext): boolean {
    try {
      return this.commandExists("osascript", context);
    } catch {
      return false;
    }
  }

  read(context: ClipboardProviderContext): ClipboardReadResult {
    const wrapped = buildNamespaceWrappedCommand(
      "osascript",
      ["-e", PNGF_SCRIPT],
      context,
      this.commandExists,
    );
    const result = this.commandRunner(wrapped.command, wrapped.args, {
      environment: context.environment,
      maxBuffer: MAX_BUFFER_BYTES,
      timeout: READ_TIMEOUT_MS,
    });

    if (result.missingCommand) {
      return { available: false, image: null };
    }

    if (!result.ok || result.stdout.length === 0) {
      return { available: true, image: null };
    }

    const bytes = parseAppleScriptPngfData(result.stdout);
    if (!bytes) {
      return { available: true, image: null };
    }

    return {
      available: true,
      image: {
        bytes,
        mimeType: "image/png",
      },
    };
  }
}
