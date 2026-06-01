import { normalizeMimeType, selectPreferredImageMimeType } from "../image-mime.js";
import {
  defaultCommandRunner,
  LIST_TYPES_TIMEOUT_MS,
  MAX_BUFFER_BYTES,
  READ_TIMEOUT_MS,
  type CommandRunner,
} from "./command-runner.js";
import type { ClipboardImageProvider, ClipboardProviderContext, ClipboardReadResult } from "./types.js";

export interface WlPasteProviderOptions {
  priority?: number;
  commandRunner?: CommandRunner;
}

export class WlPasteProvider implements ClipboardImageProvider {
  readonly capabilities;
  private readonly commandRunner: CommandRunner;

  constructor(options: WlPasteProviderOptions = {}) {
    this.capabilities = {
      id: "wl-paste",
      name: "wl-paste",
      platforms: ["linux"],
      priority: options.priority ?? 10,
    };
    this.commandRunner = options.commandRunner ?? defaultCommandRunner;
  }

  isAvailable(_context: ClipboardProviderContext): boolean {
    return true;
  }

  read(context: ClipboardProviderContext): ClipboardReadResult {
    const listTypes = this.commandRunner("wl-paste", ["--list-types"], {
      environment: context.environment,
      maxBuffer: MAX_BUFFER_BYTES,
      timeout: LIST_TYPES_TIMEOUT_MS,
    });
    if (listTypes.missingCommand) {
      return { available: false, image: null };
    }

    if (!listTypes.ok) {
      return { available: true, image: null };
    }

    const mimeTypes = listTypes.stdout
      .toString("utf8")
      .split(/\r?\n/)
      .map((mimeType) => mimeType.trim())
      .filter((mimeType) => mimeType.length > 0);

    const selectedMimeType = selectPreferredImageMimeType(mimeTypes);
    if (!selectedMimeType) {
      return { available: true, image: null };
    }

    const imageData = this.commandRunner(
      "wl-paste",
      ["--type", selectedMimeType, "--no-newline"],
      {
        environment: context.environment,
        maxBuffer: MAX_BUFFER_BYTES,
        timeout: READ_TIMEOUT_MS,
      },
    );

    if (!imageData.ok || imageData.stdout.length === 0) {
      return { available: true, image: null };
    }

    return {
      available: true,
      image: {
        bytes: new Uint8Array(imageData.stdout),
        mimeType: normalizeMimeType(selectedMimeType),
      },
    };
  }
}
