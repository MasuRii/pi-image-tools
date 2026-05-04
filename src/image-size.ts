export const IMAGE_TOOLS_MAX_IMAGE_BYTES_ENV_VAR = "PI_IMAGE_TOOLS_MAX_IMAGE_BYTES";
export const DEFAULT_MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function parseMaxImageBytes(environment: NodeJS.ProcessEnv): number {
  const rawValue = environment[IMAGE_TOOLS_MAX_IMAGE_BYTES_ENV_VAR]?.trim();
  if (!rawValue) {
    return DEFAULT_MAX_IMAGE_BYTES;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(
      `${IMAGE_TOOLS_MAX_IMAGE_BYTES_ENV_VAR} must be a positive byte count when set.`,
    );
  }

  return Math.floor(parsed);
}

export function getMaxImageBytes(environment: NodeJS.ProcessEnv = process.env): number {
  return parseMaxImageBytes(environment);
}

export function formatByteLimit(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB"] as const;
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

export function assertImageWithinByteLimit(
  sizeBytes: number,
  label: string,
  environment: NodeJS.ProcessEnv = process.env,
): void {
  const maxImageBytes = getMaxImageBytes(environment);
  if (sizeBytes > maxImageBytes) {
    throw new Error(
      `${label} is too large (${formatByteLimit(sizeBytes)}). The pi-image-tools limit is ${formatByteLimit(maxImageBytes)}. Set ${IMAGE_TOOLS_MAX_IMAGE_BYTES_ENV_VAR} to a larger byte count if needed.`,
    );
  }
}

export function getBase64DecodedByteLength(base64Data: string): number {
  const normalized = base64Data.trim().replace(/^data:[^,]*,/, "").replace(/\s/g, "");
  if (normalized.length === 0) {
    return 0;
  }

  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

