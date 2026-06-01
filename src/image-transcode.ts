import { spawnSync, type SpawnSyncReturns } from "node:child_process";

import { normalizeMimeType } from "./image-mime.js";
import type { ClipboardImage } from "./types.js";

/**
 * Maximum wall-clock time for a single ImageMagick invocation. Bounded so a
 * malformed input cannot hang the extension indefinitely; well above what a
 * typical clipboard-sized image needs to convert.
 */
const TRANSCODE_TIMEOUT_MS = 30_000;

/**
 * Maximum buffered output from ImageMagick. PNG re-encoding of a typical
 * Windows screenshot is well under 5 MB; 64 MB gives us several orders of
 * magnitude of headroom while still bounding memory.
 */
const TRANSCODE_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

/**
 * MIME types that the major model providers (Anthropic, OpenAI, Bedrock, Gemini)
 * accept as image input. Anything outside this set must be transcoded before
 * being attached to a user message, otherwise providers return errors such as
 * "Unknown image type: image/bmp".
 *
 * Distinct from `SUPPORTED_IMAGE_MIME_TYPES` in `./image-mime.ts`, which
 * describes formats the *clipboard providers* know how to read (including
 * `image/bmp`). The two sets serve opposite ends of the pipeline.
 */
export const MODEL_PROVIDER_IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

/**
 * Aliases that providers (or upstream sources) sometimes emit for otherwise
 * supported formats. We canonicalize them before deciding whether to transcode
 * so a `image/jpg` source isn't unnecessarily rewritten to PNG, and so the
 * MIME we forward to the provider is always the canonical IANA spelling.
 */
const MIME_ALIASES: ReadonlyMap<string, string> = new Map([
  ["image/jpg", "image/jpeg"],
]);

function canonicalizeMimeType(mimeType: string): string {
  const normalized = normalizeMimeType(mimeType);
  return MIME_ALIASES.get(normalized) ?? normalized;
}

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
    maxBuffer: TRANSCODE_MAX_BUFFER_BYTES,
    timeout: TRANSCODE_TIMEOUT_MS,
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
 * Images already in a supported format are returned with a canonicalized MIME
 * (lower-cased, parameters stripped, `image/jpg` upgraded to `image/jpeg`) and
 * otherwise unchanged bytes. Other formats (most notably `image/bmp`, which is
 * what WSLg exposes for Windows clipboard images on the Wayland clipboard, and
 * `image/tiff` from some macOS sources) are piped through ImageMagick and
 * re-encoded as PNG.
 *
 * Throws if the source format is unsupported and no ImageMagick binary
 * (`magick` or the legacy `convert`) is available, or if the conversion fails.
 */
export function transcodeToSupportedFormat(
  image: ClipboardImage,
  options: TranscodeOptions = {},
): ClipboardImage {
  const canonicalMimeType = canonicalizeMimeType(image.mimeType);

  if (MODEL_PROVIDER_IMAGE_MIME_TYPES.has(canonicalMimeType)) {
    // Fast path: bytes are already in a provider-accepted format.
    // Return the canonicalized MIME so downstream consumers don't have to
    // worry about parameters/casing/aliases.
    return canonicalMimeType === image.mimeType
      ? image
      : { bytes: image.bytes, mimeType: canonicalMimeType };
  }

  const runner = options.runner ?? defaultTranscodeRunner;
  const tools = options.tools ?? ["magick", "convert"];

  const inputFormat = canonicalMimeType.split("/")[1] ?? "";
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
