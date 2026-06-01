import { spawnSync, type SpawnSyncReturns } from "node:child_process";

import type { ClipboardImage } from "./types.js";

/**
 * MIME types that the major model providers (Anthropic, OpenAI, Bedrock, Gemini)
 * accept as image input. Anything outside this set must be transcoded before
 * being attached to a user message, otherwise providers return errors such as
 * "Unknown image type: image/bmp".
 */
export const SUPPORTED_IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
]);

export interface TranscodeRunner {
  (
    command: string,
    args: readonly string[],
    input: Uint8Array,
  ): SpawnSyncReturns<Buffer>;
}

const defaultTranscodeRunner: TranscodeRunner = (command, args, input) =>
  spawnSync(command, args as string[], {
    input: Buffer.from(input),
    maxBuffer: 64 * 1024 * 1024,
  });

export interface TranscodeOptions {
  /** Override the spawn implementation. Mainly for tests. */
  runner?: TranscodeRunner;
  /** Override the list of candidate ImageMagick executables. */
  tools?: readonly string[];
}

/**
 * Ensure a clipboard image is in a MIME type accepted by model providers.
 *
 * Images already in a supported format are returned untouched. Other formats
 * (most notably `image/bmp`, which is what WSLg exposes for Windows clipboard
 * images on the Wayland clipboard, and `image/tiff` from some macOS sources)
 * are piped through ImageMagick and re-encoded as PNG.
 *
 * Throws if the source format is unsupported and no ImageMagick binary
 * (`magick` or the legacy `convert`) is available, or if the conversion fails.
 */
export function transcodeToSupportedFormat(
  image: ClipboardImage,
  options: TranscodeOptions = {},
): ClipboardImage {
  if (SUPPORTED_IMAGE_MIME_TYPES.has(image.mimeType)) {
    return image;
  }

  const runner = options.runner ?? defaultTranscodeRunner;
  const tools = options.tools ?? ["magick", "convert"];

  const inputFormat = image.mimeType.split("/")[1] ?? "";
  const inputSpec = inputFormat.length > 0 ? `${inputFormat}:-` : "-";

  const failures: string[] = [];
  for (const tool of tools) {
    const result = runner(tool, [inputSpec, "png:-"], image.bytes);
    if (result.error) {
      // ENOENT etc. - try the next candidate binary.
      failures.push(`${tool}: ${result.error.message}`);
      continue;
    }
    if (result.status !== 0 || !result.stdout || result.stdout.length === 0) {
      const stderr = result.stderr ? result.stderr.toString("utf8").trim() : "";
      failures.push(`${tool} exited with status ${result.status}${stderr ? `: ${stderr}` : ""}`);
      continue;
    }
    return {
      bytes: new Uint8Array(result.stdout),
      mimeType: "image/png",
    };
  }

  const detail = failures.length > 0 ? ` (${failures.join("; ")})` : "";
  throw new Error(
    `Clipboard image is in unsupported format "${image.mimeType}" and could not be transcoded to PNG. ` +
      `Install ImageMagick (\`magick\` or \`convert\`) so pi-image-tools can convert images that providers don't accept natively.${detail}`,
  );
}
