import { buildNamespaceWrappedCommand, defaultCommandExists, type CommandExists } from "../shell-environment.js";
import {
  defaultCommandRunner,
  MAX_BUFFER_BYTES,
  READ_TIMEOUT_MS,
  type CommandRunner,
} from "./command-runner.js";
import type { ClipboardImageProvider, ClipboardProviderContext, ClipboardReadResult } from "./types.js";

const PUBLIC_PNG_SCRIPT = `ObjC.import('AppKit');
const pasteboard = $.NSPasteboard.generalPasteboard;
const data = pasteboard.dataForType('public.png');
if (!data) {
  $.exit(2);
}
$.NSFileHandle.fileHandleWithStandardOutput.writeData(data);`;

export interface OsascriptPublicPngProviderOptions {
  priority?: number;
  commandRunner?: CommandRunner;
  commandExists?: CommandExists;
}

export class OsascriptPublicPngProvider implements ClipboardImageProvider {
  readonly capabilities;
  private readonly commandRunner: CommandRunner;
  private readonly commandExists: CommandExists;

  constructor(options: OsascriptPublicPngProviderOptions = {}) {
    this.capabilities = {
      id: "mac-osascript-public-png",
      name: "osascript public.png",
      platforms: ["darwin"],
      priority: options.priority ?? 20,
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
      ["-l", "JavaScript", "-e", PUBLIC_PNG_SCRIPT],
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

    return {
      available: true,
      image: {
        bytes: new Uint8Array(result.stdout),
        mimeType: "image/png",
      },
    };
  }
}
