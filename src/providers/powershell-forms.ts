import { runPowerShellCommand, type PowerShellCommandResult, type RunPowerShellCommandOptions } from "../powershell.js";
import { MAX_BUFFER_BYTES, READ_TIMEOUT_MS } from "./command-runner.js";
import type { ClipboardImageProvider, ClipboardProviderContext, ClipboardReadResult } from "./types.js";

export type PowerShellRunner = (
  script: string,
  options: RunPowerShellCommandOptions,
) => PowerShellCommandResult;

export interface PowerShellFormsProviderOptions {
  priority?: number;
  powerShellRunner?: PowerShellRunner;
}

const READ_IMAGE_SCRIPT = `
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

export class PowerShellFormsProvider implements ClipboardImageProvider {
  readonly capabilities;
  private readonly powerShellRunner: PowerShellRunner;

  constructor(options: PowerShellFormsProviderOptions = {}) {
    this.capabilities = {
      id: "powershell-forms",
      name: "Windows PowerShell Forms clipboard",
      platforms: ["win32"],
      priority: options.priority ?? 20,
    };
    this.powerShellRunner = options.powerShellRunner ?? runPowerShellCommand;
  }

  isAvailable(_context: ClipboardProviderContext): boolean {
    return true;
  }

  read(_context: ClipboardProviderContext): ClipboardReadResult {
    const result = this.powerShellRunner(READ_IMAGE_SCRIPT, {
      encoded: true,
      maxBuffer: MAX_BUFFER_BYTES,
      sta: true,
      timeout: READ_TIMEOUT_MS,
    });

    if (result.missingCommand) {
      return { available: false, image: null };
    }

    if (!result.ok) {
      return { available: true, image: null };
    }

    const base64 = result.stdout.trim();
    if (!base64) {
      return { available: true, image: null };
    }

    try {
      const bytes = Buffer.from(base64, "base64");
      if (bytes.length === 0) {
        return { available: true, image: null };
      }

      return {
        available: true,
        image: {
          bytes: new Uint8Array(bytes),
          mimeType: "image/png",
        },
      };
    } catch {
      return { available: true, image: null };
    }
  }
}
