import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ClipboardImage } from "./types.js";

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
    default:
      return "png";
  }
}

export class TempFileManager {
  private readonly baseDir: string;
  private readonly createdFiles = new Set<string>();
  private exitHookRegistered = false;

  constructor(baseDir: string = join(tmpdir(), "pi-images")) {
    this.baseDir = baseDir;
  }

  registerExitCleanup(): void {
    if (this.exitHookRegistered) {
      return;
    }

    process.once("exit", () => {
      this.cleanupSync();
    });

    this.exitHookRegistered = true;
  }

  saveImage(image: ClipboardImage): string {
    mkdirSync(this.baseDir, { recursive: true });

    const ext = extensionForImageMimeType(image.mimeType);
    const filePath = join(this.baseDir, `pi-image-${Date.now()}-${randomUUID()}.${ext}`);

    writeFileSync(filePath, Buffer.from(image.bytes));
    this.createdFiles.add(filePath);

    return filePath;
  }

  async cleanup(): Promise<void> {
    this.cleanupSync();
  }

  cleanupSync(): void {
    for (const filePath of this.createdFiles) {
      try {
        unlinkSync(filePath);
      } catch {
        // Best-effort cleanup only.
      }
    }

    this.createdFiles.clear();

    try {
      const entries = readdirSync(this.baseDir);
      if (entries.length === 0) {
        rmSync(this.baseDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore directory cleanup errors.
    }
  }
}
