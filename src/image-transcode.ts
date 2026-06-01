import { spawnSync, type SpawnSyncReturns } from "node:child_process";

import { normalizeMimeType } from "./image-mime.js";
import type { ClipboardImage } from "./types.js";

const DEFAULT_PRIMARY_TRANSCODE_TOOL = "magick";
const LEGACY_UNIX_TRANSCODE_TOOL = "convert";

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
 * Aliases and legacy MIME spellings that providers or clipboard sources may
 * emit. Canonicalization keeps supported formats on the fast path and gives
 * ImageMagick stable input format names for formats that need transcoding.
 */
const MIME_ALIASES: ReadonlyMap<string, string> = new Map([
  ["image/jpg", "image/jpeg"],
  ["image/pjpeg", "image/jpeg"],
  ["image/x-png", "image/png"],
  ["image/x-bmp", "image/bmp"],
  ["image/x-ms-bmp", "image/bmp"],
  ["image/tif", "image/tiff"],
]);

const IMAGE_MAGICK_INPUT_FORMAT_BY_MIME_TYPE: ReadonlyMap<string, string> = new Map([
  ["image/bmp", "bmp"],
  ["image/tiff", "tiff"],
  ["image/svg+xml", "svg"],
  ["image/heic", "heic"],
  ["image/heif", "heif"],
  ["image/avif", "avif"],
]);

function getDefaultTranscodeTools(platform?: NodeJS.Platform): readonly string[] {
  if (platform === "win32") {
    // Windows ships C:\Windows\System32\convert.exe, which is unrelated to
    // ImageMagick and can produce confusing failures. Prefer the modern
    // ImageMagick 7 `magick` launcher by default on Windows; callers that know
    // they have an ImageMagick `convert` on PATH can still pass `tools`.
    return [DEFAULT_PRIMARY_TRANSCODE_TOOL];
  }

  return [DEFAULT_PRIMARY_TRANSCODE_TOOL, LEGACY_UNIX_TRANSCODE_TOOL];
}

function describeTranscodeTools(tools: readonly string[]): string {
  const uniqueTools = [...new Set(tools.length > 0 ? tools : [DEFAULT_PRIMARY_TRANSCODE_TOOL])];
  if (uniqueTools.length === 1) {
    return `\`${uniqueTools[0]}\``;
  }

  const quotedTools = uniqueTools.map((tool) => `\`${tool}\``);
  return `${quotedTools.slice(0, -1).join(", ")} or ${quotedTools[quotedTools.length - 1]}`;
}

function imageMagickInputFormatForMimeType(canonicalMimeType: string): string {
  const mappedFormat = IMAGE_MAGICK_INPUT_FORMAT_BY_MIME_TYPE.get(canonicalMimeType);
  if (mappedFormat) {
    return mappedFormat;
  }

  if (!canonicalMimeType.startsWith("image/")) {
    return "";
  }

  const subtype = canonicalMimeType.slice("image/".length);
  return subtype.split("+")[0] ?? "";
}

function isMissingCommandError(error: Error): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

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
    windowsHide: true,
  });

export interface TranscodeOptions {
  /** Override the spawn implementation. Mainly for tests. */
  runner?: TranscodeRunner;
  /** Override the list of candidate ImageMagick executables. */
  tools?: readonly string[];
  /** Platform used to choose safe default ImageMagick executable fallbacks. */
  platform?: NodeJS.Platform;
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
  const platform = options.platform ?? process.platform;
  const tools = options.tools ?? getDefaultTranscodeTools(platform);

  const inputFormat = imageMagickInputFormatForMimeType(canonicalMimeType);
  const inputSpec = inputFormat.length > 0 ? `${inputFormat}:-` : "-";

  const failures: string[] = [];
  for (const tool of tools) {
    const result = runner(tool, [inputSpec, "png:-"], image.bytes);
    if (result.error) {
      failures.push(`${tool}: ${result.error.message}`);
      if (isMissingCommandError(result.error)) {
        continue;
      }
      break;
    }
    if (result.status !== 0 || !result.stdout || result.stdout.length === 0) {
      const stderr = result.stderr ? result.stderr.toString("utf8").trim() : "";
      failures.push(`${tool} exited with status ${result.status}${stderr ? `: ${stderr}` : ""}`);
      break;
    }
    return {
      bytes: new Uint8Array(result.stdout),
      mimeType: "image/png",
    };
  }

  const detail = failures.length > 0
    ? ` (${failures.join("; ")})`
    : tools.length === 0
      ? " (no transcode tools configured)"
      : "";
  throw new Error(
    `Clipboard image is in unsupported format "${image.mimeType}" and could not be transcoded to PNG. ` +
      `Install ImageMagick (${describeTranscodeTools(tools)}) so pi-image-tools can convert images that providers don't accept natively.${detail}`,
  );
}
