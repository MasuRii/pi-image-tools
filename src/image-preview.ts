import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  calculateImageRows,
  Container,
  getCapabilities,
  getImageDimensions,
  Image,
  Spacer,
  Text,
  type Component,
} from "@mariozechner/pi-tui";

import { buildSixelRenderLines, ensureCompleteSixelSequence } from "./sixel-protocol.js";
import {
  DEFAULT_TERMINAL_IMAGE_WIDTH_CELLS,
  type TerminalImageWidthOptions,
  resolveTerminalImageWidthCells,
} from "./terminal-image-width.js";

export const IMAGE_PREVIEW_CUSTOM_TYPE = "pi-image-tools-preview";
const MAX_IMAGES_PER_MESSAGE = 3;
const POWER_SHELL_TIMEOUT_MS = 120_000;
const POWER_SHELL_MAX_BUFFER_BYTES = 128 * 1024 * 1024;
const FORCE_SIXEL_ENV_VAR = "PI_IMAGE_TOOLS_FORCE_SIXEL";
const DISABLE_SIXEL_ENV_VAR = "PI_IMAGE_TOOLS_DISABLE_SIXEL";

export type ImagePayload = {
  type: "image";
  data: string;
  mimeType: string;
};

type SixelAvailability = {
  checked: boolean;
  available: boolean;
  version?: string;
  reason?: string;
};

export type ImagePreviewItem = {
  protocol: "sixel" | "native";
  mimeType: string;
  rows: number;
  maxWidthCells: number;
  sixelSequence?: string;
  data?: string;
  warning?: string;
};

export type ImagePreviewDetails = {
  items: ImagePreviewItem[];
};

interface ThemeLike {
  fg(color: string, text: string): string;
}

class SixelImageComponent implements Component {
  constructor(
    private readonly sequence: string,
    private readonly rows: number,
  ) {}

  invalidate(): void {}

  render(_width: number): string[] {
    return buildSixelRenderLines(this.sequence, this.rows);
  }
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "Unknown error";
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function normalizeEnvValue(value: string | undefined): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isTruthyEnvFlag(value: string | undefined): boolean {
  const normalized = normalizeEnvValue(value);
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function shouldAttemptSixelRendering(): boolean {
  if (process.platform !== "win32") {
    return false;
  }

  if (isTruthyEnvFlag(process.env[DISABLE_SIXEL_ENV_VAR])) {
    return false;
  }

  if (isTruthyEnvFlag(process.env[FORCE_SIXEL_ENV_VAR])) {
    return true;
  }

  return !getCapabilities().images;
}

function runPowerShellCommand(
  script: string,
  args: string[] = [],
): { ok: boolean; stdout: string; stderr: string; reason?: string } {
  if (process.platform !== "win32") {
    return {
      ok: false,
      stdout: "",
      stderr: "",
      reason: "PowerShell-based Sixel rendering is only available on Windows.",
    };
  }

  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script,
      ...args,
    ],
    {
      encoding: "utf8",
      timeout: POWER_SHELL_TIMEOUT_MS,
      maxBuffer: POWER_SHELL_MAX_BUFFER_BYTES,
      windowsHide: true,
    },
  );

  if (result.error) {
    return {
      ok: false,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      reason: getErrorMessage(result.error),
    };
  }

  if (result.status !== 0) {
    return {
      ok: false,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      reason: `PowerShell exited with code ${result.status}`,
    };
  }

  return {
    ok: true,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

const sixelAvailabilityState: SixelAvailability = {
  checked: false,
  available: false,
};

function ensureSixelModuleAvailable(forceRefresh = false): SixelAvailability {
  if (sixelAvailabilityState.checked && !forceRefresh) {
    return sixelAvailabilityState;
  }

  const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$module = Get-Module -ListAvailable -Name Sixel | Sort-Object Version -Descending | Select-Object -First 1
if ($null -eq $module) {
  try {
    if (Get-Command Install-Module -ErrorAction SilentlyContinue) {
      Install-Module -Name Sixel -Scope CurrentUser -Force -AllowClobber -Repository PSGallery -ErrorAction Stop | Out-Null
    } elseif (Get-Command Install-PSResource -ErrorAction SilentlyContinue) {
      Install-PSResource -Name Sixel -Scope CurrentUser -TrustRepository -Reinstall -Force -ErrorAction Stop | Out-Null
    }
  } catch {
  }

  $module = Get-Module -ListAvailable -Name Sixel | Sort-Object Version -Descending | Select-Object -First 1
}

if ($null -eq $module) {
  Write-Error 'Sixel PowerShell module is unavailable.'
}

Write-Output ('Sixel/' + $module.Version.ToString())
`;

  const result = runPowerShellCommand(script);
  sixelAvailabilityState.checked = true;

  if (!result.ok) {
    const stderr = normalizeText(result.stderr);
    const stdout = normalizeText(result.stdout);
    sixelAvailabilityState.available = false;
    sixelAvailabilityState.version = undefined;
    sixelAvailabilityState.reason =
      stderr || stdout || result.reason || "Failed to detect/install the Sixel PowerShell module.";
    return sixelAvailabilityState;
  }

  const marker = normalizeText(result.stdout)
    .split(/\r?\n/)
    .find((line) => line.startsWith("Sixel/"));
  sixelAvailabilityState.available = true;
  sixelAvailabilityState.version = marker ? marker.slice("Sixel/".length) : undefined;
  sixelAvailabilityState.reason = undefined;
  return sixelAvailabilityState;
}

function extensionForImageMimeType(mimeType: string): string {
  const normalized = mimeType.split(";")[0]?.trim().toLowerCase() ?? mimeType.toLowerCase();
  switch (normalized) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/bmp":
      return "bmp";
    case "image/tiff":
      return "tiff";
    default:
      return "png";
  }
}

function escapePowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}

function convertImageToSixelSequence(
  image: ImagePayload,
): { sequence?: string; error?: string } {
  const tempBaseDir = mkdtempSync(join(tmpdir(), "pi-image-tools-image-"));
  const imagePath = join(tempBaseDir, `preview.${extensionForImageMimeType(image.mimeType)}`);

  try {
    const bytes = Buffer.from(image.data, "base64");
    if (bytes.length === 0) {
      return { error: "Image conversion failed: clipboard payload was empty." };
    }

    writeFileSync(imagePath, bytes);

    const escapedPath = escapePowerShellSingleQuoted(imagePath);

    const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$path = '${escapedPath}'

Import-Module Sixel -ErrorAction Stop
if (-not (Test-Path -LiteralPath $path)) {
  throw "Image path does not exist: $path"
}

$rendered = ConvertTo-Sixel -Path $path -Protocol Sixel -Force
if ([string]::IsNullOrWhiteSpace($rendered)) {
  throw 'ConvertTo-Sixel returned empty output.'
}

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Write-Output $rendered
`;

    const result = runPowerShellCommand(script);
    if (!result.ok) {
      const detail = normalizeText(result.stderr) || normalizeText(result.stdout) || result.reason;
      return {
        error: detail
          ? `Sixel conversion failed: ${detail}`
          : "Sixel conversion failed for an unknown reason.",
      };
    }

    const normalized = ensureCompleteSixelSequence(result.stdout);
    if (!normalized) {
      return { error: "Sixel conversion produced empty output." };
    }

    return { sequence: normalized };
  } catch (error) {
    return { error: `Sixel conversion failed: ${getErrorMessage(error)}` };
  } finally {
    try {
      rmSync(tempBaseDir, { recursive: true, force: true });
    } catch {
    }
  }
}

function estimateImageRows(image: ImagePayload, maxWidthCells: number): number {
  const dimensions = getImageDimensions(image.data, image.mimeType);
  if (!dimensions) {
    return 12;
  }

  return Math.max(1, Math.min(calculateImageRows(dimensions, maxWidthCells), 80));
}

function parseImagePreviewDetails(value: unknown): ImagePreviewDetails | null {
  const record = toRecord(value);
  const itemsRaw = record.items;
  if (!Array.isArray(itemsRaw)) {
    return null;
  }

  const items: ImagePreviewItem[] = [];
  for (const raw of itemsRaw) {
    const itemRecord = toRecord(raw);
    const protocol = itemRecord.protocol === "sixel" ? "sixel" : "native";
    const mimeType = typeof itemRecord.mimeType === "string" ? itemRecord.mimeType : "image/png";
    const rows =
      typeof itemRecord.rows === "number" && Number.isFinite(itemRecord.rows)
        ? Math.max(1, Math.min(Math.trunc(itemRecord.rows), 80))
        : 12;
    const maxWidthCells =
      typeof itemRecord.maxWidthCells === "number" && Number.isFinite(itemRecord.maxWidthCells)
        ? Math.max(4, Math.min(Math.trunc(itemRecord.maxWidthCells), 240))
        : DEFAULT_TERMINAL_IMAGE_WIDTH_CELLS;
    const sixelSequence =
      typeof itemRecord.sixelSequence === "string" ? itemRecord.sixelSequence : undefined;
    const data = typeof itemRecord.data === "string" ? itemRecord.data : undefined;
    const warning = typeof itemRecord.warning === "string" ? itemRecord.warning : undefined;

    if (protocol === "sixel" && !sixelSequence) {
      continue;
    }

    if (protocol === "native" && !data) {
      continue;
    }

    items.push({
      protocol,
      mimeType,
      rows,
      maxWidthCells,
      sixelSequence,
      data,
      warning,
    });
  }

  if (items.length === 0) {
    return null;
  }

  return { items };
}

export type BuildPreviewItemsOptions = TerminalImageWidthOptions;

export function buildPreviewItems(
  images: readonly ImagePayload[],
  options: BuildPreviewItemsOptions = {},
): ImagePreviewItem[] {
  const selectedImages = images.slice(0, MAX_IMAGES_PER_MESSAGE);
  if (selectedImages.length === 0) {
    return [];
  }

  const maxWidthCells = resolveTerminalImageWidthCells(options);
  const attemptSixel = shouldAttemptSixelRendering();
  const sixelState = attemptSixel ? ensureSixelModuleAvailable() : undefined;

  return selectedImages.map((image) => {
    const rows = estimateImageRows(image, maxWidthCells);

    if (attemptSixel && sixelState?.available) {
      const conversion = convertImageToSixelSequence(image);
      if (conversion.sequence) {
        return {
          protocol: "sixel",
          mimeType: image.mimeType,
          rows,
          maxWidthCells,
          sixelSequence: conversion.sequence,
        };
      }

      return {
        protocol: "native",
        mimeType: image.mimeType,
        rows,
        maxWidthCells,
        data: image.data,
        warning: conversion.error,
      };
    }

    return {
      protocol: "native",
      mimeType: image.mimeType,
      rows,
      maxWidthCells,
      data: image.data,
      warning:
        attemptSixel && sixelState && !sixelState.available
          ? `Sixel preview unavailable: ${sixelState.reason || "missing PowerShell Sixel module."}`
          : undefined,
    };
  });
}

export function registerImagePreviewDisplay(pi: ExtensionAPI): void {
  let warnedSixelSetup = false;

  pi.registerMessageRenderer<ImagePreviewDetails>(
    IMAGE_PREVIEW_CUSTOM_TYPE,
    (message, _options, theme) => {
      const details = parseImagePreviewDetails(message.details);
      if (!details) {
        return undefined;
      }

      const uiTheme = theme as unknown as ThemeLike;
      const container = new Container();
      const imageCount = details.items.length;
      const imageLabel = imageCount === 1 ? "image" : "images";

      container.addChild(new Spacer(1));
      container.addChild(new Text(uiTheme.fg("muted", `↳ pasted ${imageLabel} preview`), 0, 0));

      for (const item of details.items) {
        container.addChild(new Spacer(1));

        if (item.protocol === "sixel" && item.sixelSequence) {
          container.addChild(new SixelImageComponent(item.sixelSequence, item.rows));
        } else if (item.data) {
          container.addChild(
            new Image(
              item.data,
              item.mimeType,
              {
                fallbackColor: (text: string) => uiTheme.fg("toolOutput", text),
              },
              {
                maxWidthCells: item.maxWidthCells,
              },
            ),
          );
        }

        if (item.warning) {
          container.addChild(new Text(uiTheme.fg("warning", item.warning), 0, 0));
        }
      }

      return container;
    },
  );

  pi.on("session_start", async (_event, ctx) => {
    if (!shouldAttemptSixelRendering()) {
      return;
    }

    const availability = ensureSixelModuleAvailable();
    if (!availability.available && !warnedSixelSetup && ctx.hasUI) {
      warnedSixelSetup = true;
      ctx.ui.notify(
        `Image preview fallback active: ${availability.reason || "Sixel module unavailable."}`,
        "warning",
      );
    }
  });
}
