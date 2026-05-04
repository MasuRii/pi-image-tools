import { SettingsManager, getAgentDir } from "@mariozechner/pi-coding-agent";
import { resolve } from "node:path";

import { isRecord } from "./config.js";

export const DEFAULT_TERMINAL_IMAGE_WIDTH_CELLS = 60;

export interface TerminalImageWidthOptions {
  cwd?: string;
  agentDir?: string;
}

interface SettingsWithOptionalTerminalWidth {
  terminal?: {
    imageWidthCells?: unknown;
  };
}

type SettingsManagerWithOptionalWidthGetter = SettingsManager & {
  getImageWidthCells?: () => number;
};

let activeTerminalSettingsCwd = process.cwd();

function normalizeDirectoryPath(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  return resolve(trimmed);
}

function normalizeImageWidthCells(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_TERMINAL_IMAGE_WIDTH_CELLS;
  }

  return Math.max(1, Math.floor(value));
}

function readRawImageWidthCells(settings: unknown): unknown {
  if (!isRecord(settings)) {
    return undefined;
  }

  return (settings as SettingsWithOptionalTerminalWidth).terminal?.imageWidthCells;
}

function resolveSettingsManagerImageWidthCells(settingsManager: SettingsManager): unknown {
  const settingsManagerWithOptionalWidthGetter =
    settingsManager as SettingsManagerWithOptionalWidthGetter;

  if (typeof settingsManagerWithOptionalWidthGetter.getImageWidthCells === "function") {
    return settingsManagerWithOptionalWidthGetter.getImageWidthCells();
  }

  const projectWidth = readRawImageWidthCells(settingsManager.getProjectSettings());
  if (projectWidth !== undefined) {
    return projectWidth;
  }

  return readRawImageWidthCells(settingsManager.getGlobalSettings());
}

export function setActiveTerminalImageSettingsCwd(cwd: string | undefined): void {
  const normalized = normalizeDirectoryPath(cwd);
  if (normalized) {
    activeTerminalSettingsCwd = normalized;
  }
}

export function resolveTerminalImageWidthCells(
  options: TerminalImageWidthOptions = {},
): number {
  const cwd = normalizeDirectoryPath(options.cwd) ?? activeTerminalSettingsCwd;

  try {
    const settingsManager = SettingsManager.create(
      cwd,
      normalizeDirectoryPath(options.agentDir) ?? getAgentDir(),
    );

    return normalizeImageWidthCells(resolveSettingsManagerImageWidthCells(settingsManager));
  } catch {
    return DEFAULT_TERMINAL_IMAGE_WIDTH_CELLS;
  }
}
