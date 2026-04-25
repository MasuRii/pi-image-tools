import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { getExtensionRoot, type ImageToolsConfig } from "./config.js";

const DEBUG_DIRECTORY_NAME = "debug";
const DEBUG_LOG_FILE_NAME = "debug.log";

type DebugFields = Record<string, unknown>;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Unknown error";
}

export class DebugLogger {
  private readonly logPath: string | undefined;

  private constructor(private readonly enabled: boolean) {
    this.logPath = enabled ? join(getExtensionRoot(), DEBUG_DIRECTORY_NAME, DEBUG_LOG_FILE_NAME) : undefined;
  }

  static create(config: ImageToolsConfig): DebugLogger {
    return new DebugLogger(config.debug);
  }

  log(event: string, fields: DebugFields = {}): void {
    if (!this.enabled || !this.logPath) {
      return;
    }

    const debugDirectory = join(getExtensionRoot(), DEBUG_DIRECTORY_NAME);

    try {
      mkdirSync(debugDirectory, { recursive: true });
      appendFileSync(
        this.logPath,
        `${JSON.stringify({ timestamp: new Date().toISOString(), event, ...fields })}\n`,
        "utf-8",
      );
    } catch (error) {
      throw new Error(`pi-image-tools debug logging failed at ${this.logPath}: ${getErrorMessage(error)}`);
    }
  }
}
