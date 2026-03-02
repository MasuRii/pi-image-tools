import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

import type { ClipboardImage, ClipboardModule } from "./types.js";

const require = createRequire(import.meta.url);

let cachedClipboardModule: ClipboardModule | null | undefined;

function loadClipboardModule(): ClipboardModule | null {
  if (cachedClipboardModule !== undefined) {
    return cachedClipboardModule;
  }

  try {
    cachedClipboardModule = require("@mariozechner/clipboard") as ClipboardModule;
  } catch {
    cachedClipboardModule = null;
  }

  return cachedClipboardModule;
}

async function readClipboardImageViaNativeModule(): Promise<ClipboardImage | null> {
  const clipboard = loadClipboardModule();
  if (!clipboard || !clipboard.hasImage()) {
    return null;
  }

  const imageData = await clipboard.getImageBinary();
  if (!imageData || imageData.length === 0) {
    return null;
  }

  const bytes = imageData instanceof Uint8Array ? imageData : Uint8Array.from(imageData);
  return { bytes, mimeType: "image/png" };
}

function encodePowerShell(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

function readClipboardImageViaPowerShell(): ClipboardImage | null {
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if (-not [System.Windows.Forms.Clipboard]::ContainsImage()) {
  return
}

$image = [System.Windows.Forms.Clipboard]::GetImage()
if ($null -eq $image) {
  return
}

$stream = New-Object System.IO.MemoryStream
try {
  $image.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  [System.Convert]::ToBase64String($stream.ToArray())
} finally {
  $stream.Dispose()
  $image.Dispose()
}
`;

  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-STA",
      "-EncodedCommand",
      encodePowerShell(script),
    ],
    {
      encoding: "utf8",
      timeout: 6000,
      maxBuffer: 50 * 1024 * 1024,
      windowsHide: true,
    },
  );

  if (result.error || result.status !== 0) {
    return null;
  }

  const base64 = result.stdout.trim();
  if (!base64) {
    return null;
  }

  try {
    const bytes = Buffer.from(base64, "base64");
    if (bytes.length === 0) {
      return null;
    }
    return { bytes: new Uint8Array(bytes), mimeType: "image/png" };
  } catch {
    return null;
  }
}

export async function readClipboardImage(platform: NodeJS.Platform = process.platform): Promise<ClipboardImage | null> {
  if (platform !== "win32") {
    return null;
  }

  try {
    return (await readClipboardImageViaNativeModule()) ?? readClipboardImageViaPowerShell();
  } catch {
    return readClipboardImageViaPowerShell();
  }
}
