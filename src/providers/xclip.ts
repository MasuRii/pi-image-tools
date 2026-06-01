import { normalizeMimeType, selectPreferredImageMimeType, SUPPORTED_IMAGE_MIME_TYPES } from "../image-mime.js";
import {
  defaultCommandRunner,
  LIST_TYPES_TIMEOUT_MS,
  MAX_BUFFER_BYTES,
  READ_TIMEOUT_MS,
  type CommandRunner,
} from "./command-runner.js";
import type { ClipboardImageProvider, ClipboardProviderContext, ClipboardReadResult } from "./types.js";

export interface XclipProviderOptions {
  priority?: number;
  commandRunner?: CommandRunner;
}

export class XclipProvider implements ClipboardImageProvider {
  readonly capabilities;
  private readonly commandRunner: CommandRunner;

  constructor(options: XclipProviderOptions = {}) {
    this.capabilities = {
      id: "xclip",
      name: "xclip",
      platforms: ["linux"],
      priority: options.priority ?? 20,
    };
    this.commandRunner = options.commandRunner ?? defaultCommandRunner;
  }

  isAvailable(_context: ClipboardProviderContext): boolean {
    return true;
  }

  read(context: ClipboardProviderContext): ClipboardReadResult {
    const targets = this.commandRunner(
      "xclip",
      ["-selection", "clipboard", "-t", "TARGETS", "-o"],
      {
        environment: context.environment,
        maxBuffer: MAX_BUFFER_BYTES,
        timeout: LIST_TYPES_TIMEOUT_MS,
      },
    );

    if (targets.missingCommand) {
      return { available: false, image: null };
    }

    const advertisedMimeTypes = targets.ok
      ? targets.stdout
          .toString("utf8")
          .split(/\r?\n/)
          .map((mimeType) => mimeType.trim())
          .filter((mimeType) => mimeType.length > 0)
      : [];

    const preferredMimeType =
      advertisedMimeTypes.length > 0 ? selectPreferredImageMimeType(advertisedMimeTypes) : null;
    const mimeTypesToTry = preferredMimeType
      ? [preferredMimeType, ...SUPPORTED_IMAGE_MIME_TYPES]
      : [...SUPPORTED_IMAGE_MIME_TYPES];

    for (const mimeType of mimeTypesToTry) {
      const imageData = this.commandRunner(
        "xclip",
        ["-selection", "clipboard", "-t", mimeType, "-o"],
        {
          environment: context.environment,
          maxBuffer: MAX_BUFFER_BYTES,
          timeout: READ_TIMEOUT_MS,
        },
      );

      if (imageData.ok && imageData.stdout.length > 0) {
        return {
          available: true,
          image: {
            bytes: new Uint8Array(imageData.stdout),
            mimeType: normalizeMimeType(mimeType),
          },
        };
      }
    }

    return { available: true, image: null };
  }
}
