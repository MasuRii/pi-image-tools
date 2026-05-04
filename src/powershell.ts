import { spawnSync } from "node:child_process";

import { getErrorMessage, isErrnoException } from "./errors.js";

export interface PowerShellCommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  missingCommand: boolean;
  reason?: string;
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
