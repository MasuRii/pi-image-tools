import { spawn, spawnSync } from "node:child_process";

import { getErrorMessage, isErrnoException } from "./errors.js";

export interface PowerShellCommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  missingCommand: boolean;
  reason?: string;
}

export interface BufferedCommandResult {
  status: number | null;
  stdout: Buffer;
  stderr: Buffer;
  error?: Error;
}

export interface RunBufferedCommandOptions {
  maxBuffer: number;
  timeout: number;
  windowsHide?: boolean;
}

export interface RunPowerShellCommandOptions {
  args?: string[];
  encoded?: boolean;
  maxBuffer: number;
  sta?: boolean;
  timeout: number;
}

function encodePowerShell(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

export function runBufferedCommand(
  command: string,
  args: readonly string[],
  options: RunBufferedCommandOptions,
): Promise<BufferedCommandResult> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, [...args], {
        windowsHide: options.windowsHide,
      });
    } catch (error) {
      resolve({
        status: null,
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
        error: error instanceof Error ? error : new Error(String(error)),
      });
      return;
    }

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let processError: Error | undefined;

    const finish = (result: BufferedCommandResult): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };

    const failAndKill = (error: Error): void => {
      processError = error;
      child.kill();
    };

    const appendChunk = (chunks: Buffer[], chunk: unknown, currentBytes: number): number => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      const nextBytes = currentBytes + buffer.length;
      if (nextBytes > options.maxBuffer && !processError) {
        failAndKill(new Error(`Command output exceeded maxBuffer (${options.maxBuffer} bytes).`));
        return nextBytes;
      }

      chunks.push(buffer);
      return nextBytes;
    };

    const timeout = setTimeout(() => {
      failAndKill(new Error(`Command timed out after ${options.timeout}ms.`));
    }, options.timeout);
    timeout.unref?.();

    child.stdout?.on("data", (chunk: unknown) => {
      stdoutBytes = appendChunk(stdoutChunks, chunk, stdoutBytes);
    });

    child.stderr?.on("data", (chunk: unknown) => {
      stderrBytes = appendChunk(stderrChunks, chunk, stderrBytes);
    });

    child.on("error", (error: Error) => {
      processError = error;
      finish({
        status: null,
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks),
        error: processError,
      });
    });

    child.on("close", (status: number | null) => {
      finish({
        status,
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks),
        error: processError,
      });
    });
  });
}

export function runPowerShellCommand(
  script: string,
  options: RunPowerShellCommandOptions,
): PowerShellCommandResult {
  if (process.platform !== "win32") {
    return {
      ok: false,
      stdout: "",
      stderr: "",
      missingCommand: false,
      reason: "PowerShell is only available through pi-image-tools on Windows.",
    };
  }

  const commandArgs = [
    "-NoProfile",
    "-NonInteractive",
    ...(options.sta ? ["-STA"] : []),
    ...(options.encoded ? ["-EncodedCommand", encodePowerShell(script)] : ["-Command", script]),
    ...(options.args ?? []),
  ];

  const result = spawnSync("powershell.exe", commandArgs, {
    encoding: "utf8",
    timeout: options.timeout,
    maxBuffer: options.maxBuffer,
    windowsHide: true,
  });

  if (result.error) {
    return {
      ok: false,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      missingCommand: isErrnoException(result.error) && result.error.code === "ENOENT",
      reason: getErrorMessage(result.error),
    };
  }

  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    missingCommand: false,
    reason: result.status === 0 ? undefined : `PowerShell exited with code ${result.status}`,
  };
}

export async function runPowerShellCommandAsync(
  script: string,
  options: RunPowerShellCommandOptions,
): Promise<PowerShellCommandResult> {
  if (process.platform !== "win32") {
    return {
      ok: false,
      stdout: "",
      stderr: "",
      missingCommand: false,
      reason: "PowerShell is only available through pi-image-tools on Windows.",
    };
  }

  const commandArgs = [
    "-NoProfile",
    "-NonInteractive",
    ...(options.sta ? ["-STA"] : []),
    ...(options.encoded ? ["-EncodedCommand", encodePowerShell(script)] : ["-Command", script]),
    ...(options.args ?? []),
  ];

  const result = await runBufferedCommand("powershell.exe", commandArgs, {
    timeout: options.timeout,
    maxBuffer: options.maxBuffer,
    windowsHide: true,
  });
  const stdout = result.stdout.toString("utf8");
  const stderr = result.stderr.toString("utf8");

  if (result.error) {
    return {
      ok: false,
      stdout,
      stderr,
      missingCommand: isErrnoException(result.error) && result.error.code === "ENOENT",
      reason: getErrorMessage(result.error),
    };
  }

  return {
    ok: result.status === 0,
    stdout,
    stderr,
    missingCommand: false,
    reason: result.status === 0 ? undefined : `PowerShell exited with code ${result.status}`,
  };
}
