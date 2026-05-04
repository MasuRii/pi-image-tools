import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";

import { extensionToMimeType, mimeTypeToExtension } from "./image-mime.js";
import { assertImageWithinByteLimit, formatByteLimit } from "./image-size.js";
import type { ClipboardImage } from "./types.js";

export const RECENT_IMAGE_ENV_VAR = "PI_IMAGE_TOOLS_RECENT_DIRS";
export const RECENT_IMAGE_CACHE_DIR_ENV_VAR = "PI_IMAGE_TOOLS_RECENT_CACHE_DIR";

const DEFAULT_MAX_RECENT_IMAGES = 30;
const DEFAULT_MAX_CACHE_FILES = 160;

const SCREENSHOT_NAME_PATTERNS: readonly RegExp[] = [
  /^screenshot/i,
  /^screen shot/i,
  /^snip/i,
  /^capture/i,
  /^img_/i,
  /^screenrecording/i,
  /^屏幕截图/i,
  /^スクリーンショット/i,
];

interface RecentImageSource {
  path: string;
  filterScreenshotNames: boolean;
}

export interface RecentImageCandidate {
  path: string;
  name: string;
  mimeType: string;
  modifiedAtMs: number;
  sizeBytes: number;
}

export interface RecentImageDiscovery {
  candidates: RecentImageCandidate[];
  searchedDirectories: string[];
}

export interface DiscoverRecentImagesOptions {
  platform?: NodeJS.Platform;
  maxItems?: number;
  homeDirectory?: string;
  environment?: NodeJS.ProcessEnv;
}

export interface PersistRecentImageOptions {
  maxCacheFiles?: number;
  environment?: NodeJS.ProcessEnv;
}

function normalizeUserPath(value: string): string {
  const trimmed = value.trim().replace(/^"|"$/g, "");
  return trimmed;
}

function expandHomePath(value: string, homeDirectory: string): string {
  if (value === "~") {
    return homeDirectory;
  }

  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return join(homeDirectory, value.slice(2));
  }

  return value;
}

function normalizePath(pathValue: string, homeDirectory: string): string {
  return resolve(expandHomePath(normalizeUserPath(pathValue), homeDirectory));
}

export function getRecentImageCacheDirectory(environment: NodeJS.ProcessEnv = process.env): string {
  const homeDirectory = homedir();
  const configuredPath = environment[RECENT_IMAGE_CACHE_DIR_ENV_VAR];

  if (configuredPath && configuredPath.trim().length > 0) {
    return normalizePath(configuredPath, homeDirectory);
  }

  return join(tmpdir(), "pi-image-tools", "recent-cache");
}

function parseConfiguredSources(environment: NodeJS.ProcessEnv, homeDirectory: string): string[] {
  const configured = environment[RECENT_IMAGE_ENV_VAR]?.trim();
  if (!configured) {
    return [];
  }

  return configured
    .split(";")
    .map((value) => normalizePath(value, homeDirectory))
    .filter((value) => value.length > 0);
}

function getDefaultWindowsSources(homeDirectory: string): RecentImageSource[] {
  return [
    {
      path: join(homeDirectory, "Pictures", "Screenshots"),
      filterScreenshotNames: false,
    },
    {
      path: join(homeDirectory, "OneDrive", "Pictures", "Screenshots"),
      filterScreenshotNames: false,
    },
    {
      path: join(homeDirectory, "Desktop"),
      filterScreenshotNames: true,
    },
  ];
}

function getDefaultLinuxSources(homeDirectory: string): RecentImageSource[] {
  return [
    {
      path: join(homeDirectory, "Pictures", "Screenshots"),
      filterScreenshotNames: false,
    },
    {
      path: join(homeDirectory, "Pictures"),
      filterScreenshotNames: true,
    },
    {
      path: join(homeDirectory, "Downloads"),
      filterScreenshotNames: true,
    },
    {
      path: join(homeDirectory, "Desktop"),
      filterScreenshotNames: true,
    },
  ];
}

function getDefaultMacSources(homeDirectory: string): RecentImageSource[] {
  return [
    {
      path: join(homeDirectory, "Desktop"),
      filterScreenshotNames: true,
    },
    {
      path: join(homeDirectory, "Downloads"),
      filterScreenshotNames: true,
    },
    {
      path: join(homeDirectory, "Pictures", "Screenshots"),
      filterScreenshotNames: false,
    },
    {
      path: join(homeDirectory, "Pictures"),
      filterScreenshotNames: true,
    },
  ];
}

function dedupeSources(
  sources: readonly RecentImageSource[],
  platform: NodeJS.Platform,
): RecentImageSource[] {
  const deduped = new Map<string, RecentImageSource>();

  for (const source of sources) {
    const key = platform === "win32" ? source.path.toLowerCase() : source.path;
    if (!deduped.has(key)) {
      deduped.set(key, source);
    }
  }

  return [...deduped.values()];
}

function isLikelyScreenshotName(name: string): boolean {
  return SCREENSHOT_NAME_PATTERNS.some((pattern) => pattern.test(name));
}

function toMimeType(fileName: string): string | null {
  return extensionToMimeType(extname(fileName));
}

function isExtensionOwnedCacheFileName(name: string): boolean {
  return /^pi-recent-\d+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]+$/i.test(name);
}

function listRecentImagesFromSource(source: RecentImageSource): RecentImageCandidate[] {
  if (!existsSync(source.path)) {
    return [];
  }

  let names: string[];
  try {
    names = readdirSync(source.path);
  } catch {
    return [];
  }

  const candidates: RecentImageCandidate[] = [];

  for (const name of names) {
    const mimeType = toMimeType(name);
    if (!mimeType) {
      continue;
    }

    if (source.filterScreenshotNames && !isLikelyScreenshotName(name)) {
      continue;
    }

    const fullPath = join(source.path, name);

    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (!stat.isFile()) {
      continue;
    }

    candidates.push({
      path: fullPath,
      name,
      mimeType,
      modifiedAtMs: stat.mtimeMs,
      sizeBytes: stat.size,
    });
  }

  return candidates;
}

function getPlatformDefaultSources(
  platform: NodeJS.Platform,
  homeDirectory: string,
): RecentImageSource[] {
  switch (platform) {
    case "win32":
      return getDefaultWindowsSources(homeDirectory);
    case "linux":
      return getDefaultLinuxSources(homeDirectory);
    case "darwin":
      return getDefaultMacSources(homeDirectory);
    default:
      return [];
  }
}

function buildSources(options: DiscoverRecentImagesOptions): RecentImageSource[] {
  const platform = options.platform ?? process.platform;
  const homeDirectory = options.homeDirectory ?? homedir();
  const environment = options.environment ?? process.env;

  const cacheSource: RecentImageSource = {
    path: getRecentImageCacheDirectory(environment),
    filterScreenshotNames: false,
  };

  const configuredPaths = parseConfiguredSources(environment, homeDirectory);
  if (configuredPaths.length > 0) {
    return dedupeSources(
      [
        cacheSource,
        ...configuredPaths.map((pathValue) => ({
          path: pathValue,
          filterScreenshotNames: false,
        })),
      ],
      platform,
    );
  }

  return dedupeSources([cacheSource, ...getPlatformDefaultSources(platform, homeDirectory)], platform);
}

function dedupeCandidates(
  candidates: readonly RecentImageCandidate[],
  platform: NodeJS.Platform,
): RecentImageCandidate[] {
  const deduped = new Map<string, RecentImageCandidate>();

  for (const candidate of candidates) {
    const key = platform === "win32" ? candidate.path.toLowerCase() : candidate.path;

    const existing = deduped.get(key);
    if (!existing || candidate.modifiedAtMs > existing.modifiedAtMs) {
      deduped.set(key, candidate);
    }
  }

  return [...deduped.values()];
}

export function discoverRecentImages(options: DiscoverRecentImagesOptions = {}): RecentImageDiscovery {
  const platform = options.platform ?? process.platform;
  const sources = buildSources(options);
  const searchedDirectories = sources.map((source) => source.path);
  const maxItems = options.maxItems ?? DEFAULT_MAX_RECENT_IMAGES;

  if (sources.length === 0) {
    return {
      candidates: [],
      searchedDirectories,
    };
  }

  const allCandidates = sources.flatMap((source) => listRecentImagesFromSource(source));
  const sorted = dedupeCandidates(allCandidates, platform).sort(
    (left, right) => right.modifiedAtMs - left.modifiedAtMs,
  );

  return {
    candidates: sorted.slice(0, Math.max(1, maxItems)),
    searchedDirectories,
  };
}

function pruneCacheDirectory(cacheDirectory: string, maxCacheFiles: number): void {
  if (maxCacheFiles < 1 || !existsSync(cacheDirectory)) {
    return;
  }

  let entries: string[];
  try {
    entries = readdirSync(cacheDirectory);
  } catch {
    return;
  }

  const imageFiles = entries
    .map((name) => {
      const fullPath = join(cacheDirectory, name);

      try {
        const stat = statSync(fullPath);
        if (!stat.isFile()) {
          return null;
        }

        if (!isExtensionOwnedCacheFileName(name) || !toMimeType(name)) {
          return null;
        }

        return { fullPath, modifiedAtMs: stat.mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is { fullPath: string; modifiedAtMs: number } => entry !== null)
    .sort((left, right) => right.modifiedAtMs - left.modifiedAtMs);

  if (imageFiles.length <= maxCacheFiles) {
    return;
  }

  for (const staleFile of imageFiles.slice(maxCacheFiles)) {
    try {
      unlinkSync(staleFile.fullPath);
    } catch {
      // Intentionally ignore cache cleanup failures.
    }
  }
}

export function persistImageToRecentCache(
  image: ClipboardImage,
  options: PersistRecentImageOptions = {},
): string {
  if (!image.bytes || image.bytes.length === 0) {
    throw new Error("Cannot cache an empty image payload.");
  }

  const environment = options.environment ?? process.env;
  assertImageWithinByteLimit(image.bytes.length, "Cached image", environment);
  const cacheDirectory = getRecentImageCacheDirectory(environment);
  const extension = mimeTypeToExtension(image.mimeType);

  mkdirSync(cacheDirectory, { recursive: true });

  const filePath = join(cacheDirectory, `pi-recent-${Date.now()}-${randomUUID()}.${extension}`);
  writeFileSync(filePath, Buffer.from(image.bytes));

  const maxCacheFiles = options.maxCacheFiles ?? DEFAULT_MAX_CACHE_FILES;
  pruneCacheDirectory(cacheDirectory, maxCacheFiles);

  return filePath;
}

function formatRelativeAge(modifiedAtMs: number, nowMs: number): string {
  const deltaMs = Math.max(0, nowMs - modifiedAtMs);
  const deltaMinutes = Math.floor(deltaMs / 60_000);

  if (deltaMinutes < 1) {
    return "just now";
  }

  if (deltaMinutes < 60) {
    return `${deltaMinutes}m ago`;
  }

  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${deltaHours}h ago`;
  }

  const deltaDays = Math.floor(deltaHours / 24);
  if (deltaDays < 30) {
    return `${deltaDays}d ago`;
  }

  const deltaMonths = Math.floor(deltaDays / 30);
  if (deltaMonths < 12) {
    return `${deltaMonths}mo ago`;
  }

  const deltaYears = Math.floor(deltaMonths / 12);
  return `${deltaYears}y ago`;
}

function detectPathSeparator(pathValue: string): string {
  return pathValue.includes("\\") ? "\\" : "/";
}

function abbreviatePath(pathValue: string, maxChars: number): string {
  if (pathValue.length <= maxChars) {
    return pathValue;
  }

  const fileName = basename(pathValue);
  if (fileName.length + 4 >= maxChars) {
    return `...${fileName.slice(-(maxChars - 3))}`;
  }

  const separator = detectPathSeparator(pathValue);
  const headLength = maxChars - fileName.length - 4;
  return `${pathValue.slice(0, headLength)}...${separator}${fileName}`;
}

export function formatRecentImageLabel(candidate: RecentImageCandidate, nowMs = Date.now()): string {
  const age = formatRelativeAge(candidate.modifiedAtMs, nowMs);
  const size = formatByteLimit(candidate.sizeBytes);
  const shortPath = abbreviatePath(candidate.path, 64);

  return `${candidate.name} • ${age} • ${size} • ${shortPath}`;
}

export function loadRecentImage(
  candidate: RecentImageCandidate,
  environment: NodeJS.ProcessEnv = process.env,
): ClipboardImage {
  assertImageWithinByteLimit(candidate.sizeBytes, `Recent image ${candidate.name}`, environment);
  const raw = readFileSync(candidate.path);
  if (raw.length === 0) {
    throw new Error(`File is empty: ${candidate.path}`);
  }

  return {
    bytes: new Uint8Array(raw),
    mimeType: candidate.mimeType,
  };
}
