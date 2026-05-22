import { mkdirSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";

import { getExtensionRoot, type ImageToolsConfig } from "./config.js";
const DEBUG_DIRECTORY_NAME = "debug";
const DEBUG_LOG_FILE_NAME = "debug.log";
const SECRET_KEYS = /api[_-]?key|authorization|token|secret|password/i;

type DebugFields = Record<string, unknown>;

interface DebugLoggerCreateOptions {
  extensionRoot?: string;
}

function redactFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => redactFields(entry));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      output[key] = SECRET_KEYS.test(key) ? "[REDACTED]" : redactFields(nestedValue);
    }
    return output;
  }
  return value;
}

export class DebugLogger {
  private readonly debugDirectory: string | undefined;
  private readonly logPath: string | undefined;
  private debugDirectoryReady = false;
  private writeQueue: Promise<void> = Promise.resolve();

  private constructor(private readonly enabled: boolean, extensionRoot = getExtensionRoot()) {
    this.debugDirectory = enabled ? join(extensionRoot, DEBUG_DIRECTORY_NAME) : undefined;
    this.logPath = this.debugDirectory ? join(this.debugDirectory, DEBUG_LOG_FILE_NAME) : undefined;
  }

  static create(config: ImageToolsConfig, options: DebugLoggerCreateOptions = {}): DebugLogger {
    return new DebugLogger(config.debug, options.extensionRoot);
  }

  log(event: string, fields: DebugFields = {}): void {
    if (!this.enabled || !this.logPath) {
      return;
    }

    try {
      const redactedFields = redactFields(fields) as DebugFields;
      const line = `${JSON.stringify({ timestamp: new Date().toISOString(), event, ...redactedFields })}\n`;
      this.writeQueue = this.writeQueue.then(
        () => this.appendLine(line),
        () => this.appendLine(line),
      );
      void this.writeQueue.catch(() => undefined);
    } catch {
      // Debug logging must never affect extension behavior.
    }
  }

  flush(): Promise<void> {
    return this.writeQueue.catch(() => undefined);
  }

  private async appendLine(line: string): Promise<void> {
    if (!this.logPath) {
      return;
    }

    this.ensureDebugDirectory();
    await appendFile(this.logPath, line, "utf-8");
  }

  private ensureDebugDirectory(): void {
    if (this.debugDirectoryReady || !this.debugDirectory) {
      return;
    }

    mkdirSync(this.debugDirectory, { recursive: true });
    this.debugDirectoryReady = true;
  }
}
