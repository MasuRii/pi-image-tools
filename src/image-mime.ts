const PREFERRED_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
] as const;

const MIME_TYPE_TO_EXTENSION = new Map<string, string>([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["image/bmp", "bmp"],
  ["image/tiff", "tiff"],
]);

const EXTENSION_TO_MIME_TYPE = new Map<string, string>([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".bmp", "image/bmp"],
]);

export const SUPPORTED_IMAGE_MIME_TYPES: readonly string[] = PREFERRED_IMAGE_MIME_TYPES;

export function normalizeMimeType(mimeType: string): string {
  return mimeType.split(";")[0]?.trim().toLowerCase() ?? mimeType.toLowerCase();
}

export function selectPreferredImageMimeType(mimeTypes: readonly string[]): string | null {
  const normalized = mimeTypes
    .map((mimeType) => mimeType.trim())
    .filter((mimeType) => mimeType.length > 0)
    .map((mimeType) => ({ raw: mimeType, normalized: normalizeMimeType(mimeType) }));

  for (const preferredMimeType of SUPPORTED_IMAGE_MIME_TYPES) {
    const match = normalized.find((mimeType) => mimeType.normalized === preferredMimeType);
    if (match) {
      return match.raw;
    }
  }

  const firstImage = normalized.find((mimeType) => mimeType.normalized.startsWith("image/"));
  return firstImage?.raw ?? null;
}

export function mimeTypeToExtension(mimeType: string, fallbackExtension = "png"): string {
  return MIME_TYPE_TO_EXTENSION.get(normalizeMimeType(mimeType)) ?? fallbackExtension;
}

export function extensionToMimeType(fileNameOrExtension: string): string | null {
  const extension = fileNameOrExtension.startsWith(".")
    ? fileNameOrExtension.toLowerCase()
    : `.${fileNameOrExtension.toLowerCase()}`;

  return EXTENSION_TO_MIME_TYPE.get(extension) ?? null;
}
