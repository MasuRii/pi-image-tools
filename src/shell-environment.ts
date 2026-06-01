import { spawnSync } from "node:child_process";

export interface ShellCommandContext {
  platform: NodeJS.Platform;
  environment: NodeJS.ProcessEnv;
}

export type CommandExists = (command: string, context: ShellCommandContext) => boolean;

export interface WrappedCommand {
  command: string;
  args: string[];
  wrapped: boolean;
}

const COMMAND_EXISTS_TIMEOUT_MS = 1000;
const COMMAND_EXISTS_MAX_BUFFER_BYTES = 1024 * 1024;
const commandExistsCache = new Map<string, boolean>();

export function hasGraphicalSession(platform: NodeJS.Platform, environment: NodeJS.ProcessEnv): boolean {
  return platform !== "linux" || Boolean(environment.DISPLAY || environment.WAYLAND_DISPLAY);
}

export function isWaylandSession(environment: NodeJS.ProcessEnv): boolean {
  return Boolean(environment.WAYLAND_DISPLAY) || environment.XDG_SESSION_TYPE === "wayland";
}

export function isTmuxSession(environment: NodeJS.ProcessEnv): boolean {
  return Boolean(environment.TMUX);
}

export const defaultCommandExists: CommandExists = (command, context) => {
  const lookupCommand = context.platform === "win32" ? "where" : "which";
  const cacheKey = `${context.platform}:${lookupCommand}:${command}:${context.environment.PATH ?? ""}`;
  const cached = commandExistsCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const result = spawnSync(lookupCommand, [command], {
    env: context.environment,
    maxBuffer: COMMAND_EXISTS_MAX_BUFFER_BYTES,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: COMMAND_EXISTS_TIMEOUT_MS,
    windowsHide: true,
  });
  const exists = !result.error && result.status === 0;
  commandExistsCache.set(cacheKey, exists);
  return exists;
};

export function buildNamespaceWrappedCommand(
  command: string,
  args: readonly string[],
  context: ShellCommandContext,
  commandExists: CommandExists = defaultCommandExists,
): WrappedCommand {
  try {
    if (
      context.platform !== "darwin" ||
      !isTmuxSession(context.environment) ||
      !commandExists("reattach-to-user-namespace", context)
    ) {
      return { command, args: [...args], wrapped: false };
    }

    return {
      command: "reattach-to-user-namespace",
      args: [command, ...args],
      wrapped: true,
    };
  } catch {
    return { command, args: [...args], wrapped: false };
  }
}
