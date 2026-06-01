import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { KeyId } from "@earendil-works/pi-tui";

const CONFIG_FILE_NAME = "config.json";
const EXTENSION_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface ImageToolsShortcutConfig {
  avoidBuiltinConflicts: boolean;
  suppressBuiltinConflictWarnings: boolean;
  pasteImage?: KeyId[];
}

export interface ImageToolsConfig {
  debug: boolean;
  shortcuts: ImageToolsShortcutConfig;
}

export interface LoadImageToolsConfigOptions {
  platform?: NodeJS.Platform;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getExtensionRoot(): string {
  return EXTENSION_ROOT;
}

export function getConfigPath(): string {
  return join(getExtensionRoot(), CONFIG_FILE_NAME);
}

function formatConfigPath(path: string, property: string): string {
  return `${path}${property.length > 0 ? ` property \"${property}\"` : ""}`;
}

function parseBoolean(value: unknown, property: string, path: string, defaultValue = false): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  if (typeof value !== "boolean") {
    throw new Error(`Invalid pi-image-tools config at ${formatConfigPath(path, property)}: expected a boolean.`);
  }

  return value;
}

function normalizeShortcut(value: unknown, property: string, path: string): KeyId {
  if (typeof value !== "string") {
    throw new Error(`Invalid pi-image-tools config at ${formatConfigPath(path, property)}: expected a string shortcut.`);
  }

  const shortcut = value.trim();
  if (shortcut.length === 0) {
    throw new Error(`Invalid pi-image-tools config at ${formatConfigPath(path, property)}: shortcut cannot be empty.`);
  }

  return shortcut as KeyId;
}

function parseShortcutList(value: unknown, property: string, path: string): KeyId[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const rawShortcuts = Array.isArray(value) ? value : [value];
  const shortcuts: KeyId[] = [];
  const seen = new Set<string>();

  for (const [index, rawShortcut] of rawShortcuts.entries()) {
    const shortcut = normalizeShortcut(rawShortcut, `${property}[${index}]`, path);
    const normalized = shortcut.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    shortcuts.push(shortcut);
  }

  return shortcuts;
}

function getDefaultShortcutConfig(platform: NodeJS.Platform): ImageToolsShortcutConfig {
  return {
    avoidBuiltinConflicts: platform !== "darwin",
    suppressBuiltinConflictWarnings: false,
  };
}

function parseShortcutConfig(value: unknown, path: string, platform: NodeJS.Platform): ImageToolsShortcutConfig {
  const defaults = getDefaultShortcutConfig(platform);
  if (value === undefined) {
    return defaults;
  }

  if (!isRecord(value)) {
    throw new Error(`Invalid pi-image-tools config at ${formatConfigPath(path, "shortcuts")}: expected an object.`);
  }

  const avoidBuiltinConflicts = parseBoolean(
    value.avoidBuiltinConflicts,
    "shortcuts.avoidBuiltinConflicts",
    path,
    defaults.avoidBuiltinConflicts,
  );
  const suppressBuiltinConflictWarnings = parseBoolean(
    value.suppressBuiltinConflictWarnings,
    "shortcuts.suppressBuiltinConflictWarnings",
    path,
    defaults.suppressBuiltinConflictWarnings,
  );
  const pasteImage = parseShortcutList(value.pasteImage, "shortcuts.pasteImage", path);

  return pasteImage === undefined
    ? { avoidBuiltinConflicts, suppressBuiltinConflictWarnings }
    : { avoidBuiltinConflicts, suppressBuiltinConflictWarnings, pasteImage };
}

function parseConfig(rawConfig: unknown, path: string, platform: NodeJS.Platform): ImageToolsConfig {
  if (!isRecord(rawConfig)) {
    throw new Error(`Invalid pi-image-tools config at ${path}: expected a JSON object.`);
  }

  return {
    debug: parseBoolean(rawConfig.debug, "debug", path),
    shortcuts: parseShortcutConfig(rawConfig.shortcuts, path, platform),
  };
}

export function loadImageToolsConfig(path = getConfigPath(), options: LoadImageToolsConfigOptions = {}): ImageToolsConfig {
  const platform = options.platform ?? process.platform;
  if (!existsSync(path)) {
    return {
      debug: false,
      shortcuts: getDefaultShortcutConfig(platform),
    };
  }

  try {
    const rawConfig = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    return parseConfig(rawConfig, path, platform);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid pi-image-tools config at ${path}: ${error.message}`);
    }

    throw error;
  }
}
