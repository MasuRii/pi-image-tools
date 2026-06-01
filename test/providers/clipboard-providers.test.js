import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const EXTENSION_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TEST_DIST_DIR = join(EXTENSION_ROOT, ".test-providers-dist");
const TSCONFIG_PATH = join(TEST_DIST_DIR, "tsconfig.test.json");
const NPX_COMMAND = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "npx";
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function compileTestModules() {
  rmSync(TEST_DIST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIST_DIR, { recursive: true });
  writeFileSync(
    TSCONFIG_PATH,
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          noEmit: false,
          noCheck: true,
          outDir: TEST_DIST_DIR,
          rootDir: EXTENSION_ROOT,
          skipLibCheck: true,
          resolveJsonModule: true,
        },
        include: ["../index.ts", "../src/**/*.ts"],
        exclude: ["../node_modules", "../.test-providers-dist", "../test"],
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );

  const commandArgs =
    process.platform === "win32"
      ? ["/d", "/s", "/c", `npx --yes -p typescript@5.7.3 tsc -p ${TSCONFIG_PATH}`]
      : ["--yes", "-p", "typescript@5.7.3", "tsc", "-p", TSCONFIG_PATH];

  execFileSync(NPX_COMMAND, commandArgs, {
    cwd: EXTENSION_ROOT,
    stdio: "pipe",
  });
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function createTempRoot() {
  const root = mkdtempSync(join(tmpdir(), "pi-image-tools-providers-"));
  return {
    root,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function withAgentDir(agentDir, callback) {
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try {
    return callback();
  } finally {
    if (previousAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    }
  }
}

function commandResult({ ok = true, stdout = Buffer.alloc(0), missingCommand = false, status } = {}) {
  return {
    ok,
    stdout,
    stderr: Buffer.alloc(0),
    missingCommand,
    status: status ?? (ok ? 0 : 1),
  };
}

function createMockProvider({ id, priority, platforms = "*", available = true, result, calls }) {
  return {
    capabilities: { id, name: id, platforms, priority },
    isAvailable() {
      return available;
    },
    read() {
      calls?.push(id);
      return result ?? { available: true, image: null };
    },
  };
}

compileTestModules();

const { ClipboardProviderRegistry } = await import(
  pathToFileURL(join(TEST_DIST_DIR, "src", "providers", "registry.js")).href
);
const { PngpasteProvider } = await import(
  pathToFileURL(join(TEST_DIST_DIR, "src", "providers", "mac-pngpaste.js")).href
);
const { OsascriptPublicPngProvider } = await import(
  pathToFileURL(join(TEST_DIST_DIR, "src", "providers", "mac-osascript-publicpng.js")).href
);
const { OsascriptPngfProvider } = await import(
  pathToFileURL(join(TEST_DIST_DIR, "src", "providers", "mac-osascript-pngf.js")).href
);
const shellEnvironmentModule = await import(pathToFileURL(join(TEST_DIST_DIR, "src", "shell-environment.js")).href);
const configModule = await import(pathToFileURL(join(TEST_DIST_DIR, "src", "config.js")).href);
const keybindingsModule = await import(pathToFileURL(join(TEST_DIST_DIR, "src", "keybindings.js")).href);

const { buildNamespaceWrappedCommand, isTmuxSession } = shellEnvironmentModule;
const { loadImageToolsConfig } = configModule;
const { getImagePasteShortcuts } = keybindingsModule;

const { readClipboardImage, buildDefaultClipboardProviderRegistry } = await import(
  pathToFileURL(join(TEST_DIST_DIR, "src", "clipboard.js")).href
);
const { NativeModuleProvider } = await import(
  pathToFileURL(join(TEST_DIST_DIR, "src", "providers", "native-module.js")).href
);
const { WlPasteProvider } = await import(
  pathToFileURL(join(TEST_DIST_DIR, "src", "providers", "wl-paste.js")).href
);
const { XclipProvider } = await import(
  pathToFileURL(join(TEST_DIST_DIR, "src", "providers", "xclip.js")).href
);
const { PowerShellFormsProvider } = await import(
  pathToFileURL(join(TEST_DIST_DIR, "src", "providers", "powershell-forms.js")).href
);

test("provider registry preserves insertion order for same-priority providers", () => {
  const registry = new ClipboardProviderRegistry([
    createMockProvider({ id: "second", priority: 10 }),
    createMockProvider({ id: "first", priority: 10 }),
  ]);
  const providers = registry.getProviders("linux");
  assert.deepEqual(providers.map((p) => p.capabilities.id), ["second", "first"]);
});

test("readClipboardImage returns null on Termux", async () => {
  const result = await readClipboardImage({ platform: "linux", environment: { TERMUX_VERSION: "0.118" } });
  assert.equal(result, null);
});

test("readClipboardImage throws on Linux without graphical session", async () => {
  await assert.rejects(
    readClipboardImage({ platform: "linux", environment: {} }),
    /graphical desktop session/,
  );
});

test("readClipboardImage returns null when providers are available but find no image", async () => {
  const registry = new ClipboardProviderRegistry([
    createMockProvider({ id: "avail", priority: 10, available: true, result: { available: true, image: null } }),
  ]);
  const result = await readClipboardImage({ platform: "linux", environment: { DISPLAY: ":0" }, registry });
  assert.equal(result, null);
});

test("readClipboardImage throws when no providers are available", async () => {
  const registry = new ClipboardProviderRegistry([
    createMockProvider({ id: "missing", priority: 10, available: false }),
  ]);
  await assert.rejects(
    readClipboardImage({ platform: "win32", environment: {}, registry }),
    /No Windows clipboard image reader is available/,
  );
});

test("readClipboardImage transcodes unsupported MIME types using the injected runner", async () => {
  const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const BMP_BODY = Buffer.from([0x42, 0x4d, 0x01, 0x02]);
  const registry = new ClipboardProviderRegistry([
    createMockProvider({
      id: "bmp-source",
      priority: 10,
      result: { available: true, image: { bytes: new Uint8Array(BMP_BODY), mimeType: "image/bmp" } },
    }),
  ]);
  const calls = [];
  const runner = (command, args, input) => {
    calls.push({ command, args: [...args], inputLength: input.length });
    return { status: 0, stdout: PNG_HEADER, stderr: Buffer.alloc(0), pid: 0, output: [], signal: null };
  };
  const result = await readClipboardImage({
    platform: "linux",
    environment: { DISPLAY: ":0" },
    registry,
    transcode: { runner },
  });
  assert.equal(result.mimeType, "image/png");
  assert.deepEqual(Buffer.from(result.bytes), PNG_HEADER);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ["bmp:-", "png:-"]);
});

test("readClipboardImage leaves already-supported formats untouched", async () => {
  const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const registry = new ClipboardProviderRegistry([
    createMockProvider({
      id: "png-source",
      priority: 10,
      result: { available: true, image: { bytes: new Uint8Array(PNG_BYTES), mimeType: "image/png" } },
    }),
  ]);
  const runner = () => {
    throw new Error("transcoder must not be invoked for supported formats");
  };
  const result = await readClipboardImage({
    platform: "linux",
    environment: { DISPLAY: ":0" },
    registry,
    transcode: { runner },
  });
  assert.equal(result.mimeType, "image/png");
});

test("buildDefaultClipboardProviderRegistry produces correct Windows provider order", () => {
  const registry = buildDefaultClipboardProviderRegistry("win32", {});
  const ids = registry.getProviders("win32").map((p) => p.capabilities.id);
  assert.deepEqual(ids, ["native-module", "powershell-forms"]);
});

test("buildDefaultClipboardProviderRegistry puts wl-paste first on Linux Wayland", () => {
  const registry = buildDefaultClipboardProviderRegistry("linux", { WAYLAND_DISPLAY: "wayland-1" });
  const ids = registry.getProviders("linux").map((p) => p.capabilities.id);
  assert.deepEqual(ids, ["wl-paste", "xclip", "native-module"]);
});

test("buildDefaultClipboardProviderRegistry puts xclip first on Linux X11", () => {
  const registry = buildDefaultClipboardProviderRegistry("linux", { DISPLAY: ":0" });
  const ids = registry.getProviders("linux").map((p) => p.capabilities.id);
  assert.deepEqual(ids, ["xclip", "wl-paste", "native-module"]);
});

test("buildDefaultClipboardProviderRegistry produces correct Darwin provider order", () => {
  const registry = buildDefaultClipboardProviderRegistry("darwin", {});
  const ids = registry.getProviders("darwin").map((p) => p.capabilities.id);
  assert.deepEqual(ids, ["mac-pngpaste", "mac-osascript-public-png", "mac-osascript-pngf", "native-module"]);
});

test("registry getProviders excludes providers not supporting the platform", () => {
  const registry = new ClipboardProviderRegistry([
    createMockProvider({ id: "win", priority: 10, platforms: ["win32"] }),
    createMockProvider({ id: "all", priority: 20, platforms: "*" }),
  ]);
  const ids = registry.getProviders("linux").map((p) => p.capabilities.id);
  assert.deepEqual(ids, ["all"]);
});

test("macOS osascript public.png provider wraps command under tmux when namespace helper exists", async () => {
  const calls = [];
  const provider = new OsascriptPublicPngProvider({
    commandExists: (cmd) => cmd === "osascript" || cmd === "reattach-to-user-namespace",
    commandRunner(command, args) {
      calls.push({ command, args: [...args] });
      return commandResult({ stdout: PNG_BYTES });
    },
  });
  const result = await provider.read({ platform: "darwin", environment: { TMUX: "/tmp/tmux" } });
  assert.equal(result.available, true);
  assert.equal(calls[0].command, "reattach-to-user-namespace");
  assert.deepEqual(calls[0].args.slice(0, 2), ["osascript", "-l"]);
});

test("macOS osascript PNGf provider wraps command under tmux when namespace helper exists", async () => {
  const calls = [];
  const provider = new OsascriptPngfProvider({
    commandExists: (cmd) => cmd === "osascript" || cmd === "reattach-to-user-namespace",
    commandRunner(command, args) {
      calls.push({ command, args: [...args] });
      return commandResult({ stdout: Buffer.from("«data PNGf89504E470D0A1A0A»\n", "utf8") });
    },
  });
  const result = await provider.read({ platform: "darwin", environment: { TMUX: "/tmp/tmux" } });
  assert.equal(result.available, true);
  assert.equal(calls[0].command, "reattach-to-user-namespace");
  assert.equal(calls[0].args[0], "osascript");
});

test("macOS osascript public.png handles exit code 2 as available with no image", async () => {
  const provider = new OsascriptPublicPngProvider({
    commandExists: () => true,
    commandRunner: () => commandResult({ ok: false, status: 2, stdout: Buffer.alloc(0) }),
  });
  const result = await provider.read({ platform: "darwin", environment: {} });
  assert.equal(result.available, true);
  assert.equal(result.image, null);
});

test("macOS osascript PNGf provider handles whitespace-separated hex", async () => {
  const provider = new OsascriptPngfProvider({
    commandExists: () => true,
    commandRunner: () => commandResult({ stdout: Buffer.from("«data PNGf89 50 4E 47 0D 0A 1A 0A»", "utf8") }),
  });
  const result = await provider.read({ platform: "darwin", environment: {} });
  assert.equal(result.image?.mimeType, "image/png");
  assert.deepEqual(Array.from(result.image.bytes), Array.from(PNG_BYTES));
});

test("macOS osascript PNGf provider rejects odd-length hex", async () => {
  const provider = new OsascriptPngfProvider({
    commandExists: () => true,
    commandRunner: () => commandResult({ stdout: Buffer.from("«data PNGf89504»", "utf8") }),
  });
  const result = await provider.read({ platform: "darwin", environment: {} });
  assert.equal(result.available, true);
  assert.equal(result.image, null);
});

test("macOS osascript PNGf provider ignores non-PNGf clipboard type", async () => {
  const provider = new OsascriptPngfProvider({
    commandExists: () => true,
    commandRunner: () => commandResult({ stdout: Buffer.from("«data TIFF4D4D002A»", "utf8") }),
  });
  const result = await provider.read({ platform: "darwin", environment: {} });
  assert.equal(result.available, true);
  assert.equal(result.image, null);
});

test("macOS osascript PNGf provider handles empty AppleScript output", async () => {
  const provider = new OsascriptPngfProvider({
    commandExists: () => true,
    commandRunner: () => commandResult({ stdout: Buffer.alloc(0) }),
  });
  const result = await provider.read({ platform: "darwin", environment: {} });
  assert.equal(result.available, true);
  assert.equal(result.image, null);
});

test("macOS osascript PNGf provider handles mixed-case hex", async () => {
  const provider = new OsascriptPngfProvider({
    commandExists: () => true,
    commandRunner: () => commandResult({ stdout: Buffer.from("«data PNGfaAbBcCdDeEfF0A0B»", "utf8") }),
  });
  const result = await provider.read({ platform: "darwin", environment: {} });
  assert.equal(result.image?.mimeType, "image/png");
  const expected = Buffer.from("aAbBcCdDeEfF0A0B", "hex");
  assert.deepEqual(Array.from(result.image.bytes), Array.from(expected));
});

test("macOS osascript PNGf provider handles whitespace-only hex data", async () => {
  const provider = new OsascriptPngfProvider({
    commandExists: () => true,
    commandRunner: () => commandResult({ stdout: Buffer.from("«data PNGf   \t»", "utf8") }),
  });
  const result = await provider.read({ platform: "darwin", environment: {} });
  assert.equal(result.available, true);
  assert.equal(result.image, null);
});

test("macOS pngpaste ignores stderr warnings and returns image", async () => {
  const provider = new PngpasteProvider({
    commandExists: () => true,
    commandRunner: () => commandResult({
      stdout: PNG_BYTES,
      stderr: Buffer.from("deprecated warning\n", "utf8"),
    }),
  });
  const result = await provider.read({ platform: "darwin", environment: {} });
  assert.equal(result.available, true);
  assert.deepEqual(Array.from(result.image.bytes), Array.from(PNG_BYTES));
});

test("commandRunner maxBuffer overflow returns available true image null", () => {
  const provider = new PngpasteProvider({
    commandExists: () => true,
    commandRunner: () => commandResult({ ok: false, stdout: Buffer.alloc(0), missingCommand: false, status: null }),
  });
  const result = provider.read({ platform: "darwin", environment: {} });
  assert.equal(result.available, true);
  assert.equal(result.image, null);
});

test("Linux wl-paste returns available true image null on list-types failure", () => {
  const provider = new WlPasteProvider({
    commandRunner: (command, args) => {
      if (args.includes("--list-types")) {
        return commandResult({ ok: false, missingCommand: false, status: 1 });
      }
      return commandResult({ ok: true, stdout: PNG_BYTES });
    },
  });
  const result = provider.read({ platform: "linux", environment: {} });
  assert.equal(result.available, true);
  assert.equal(result.image, null);
});

test("Linux xclip falls back to iterating MIME types when TARGETS fails", () => {
  const calls = [];
  const provider = new XclipProvider({
    commandRunner: (command, args) => {
      calls.push({ command, args: [...args] });
      if (args.includes("TARGETS")) {
        return commandResult({ ok: false, missingCommand: false, status: 1 });
      }
      if (args.includes("-t") && args.includes("image/png")) {
        return commandResult({ ok: true, stdout: PNG_BYTES });
      }
      return commandResult({ ok: false, stdout: Buffer.alloc(0) });
    },
  });
  const result = provider.read({ platform: "linux", environment: {} });
  assert.equal(result.available, true);
  assert.deepEqual(Array.from(result.image.bytes), Array.from(PNG_BYTES));
  assert.ok(calls.some((c) => c.args.includes("TARGETS")));
  assert.ok(calls.some((c) => c.args.includes("image/png")));
});

test("Native module returns available true image null when clipboard has no image", async () => {
  const provider = new NativeModuleProvider({
    moduleLoader: () => ({
      hasImage: () => false,
      getImageBinary: async () => null,
    }),
  });
  const result = await provider.read({ platform: "win32", environment: {} });
  assert.equal(result.available, true);
  assert.equal(result.image, null);
});

test("Windows PowerShell empty output returns null", () => {
  const provider = new PowerShellFormsProvider({
    powerShellRunner: () => commandResult({ ok: true, stdout: "" }),
  });
  const result = provider.read({ platform: "win32", environment: {} });
  assert.equal(result.available, true);
  assert.equal(result.image, null);
});

test("getImagePasteShortcuts uses configured pasteImage when provided", () => {
  const config = { debug: false, shortcuts: { avoidBuiltinConflicts: false, pasteImage: ["shift+ctrl+v"] } };
  const shortcuts = getImagePasteShortcuts(config, "linux");
  assert.deepEqual(shortcuts, ["shift+ctrl+v"]);
});

test("avoidBuiltinConflicts filters known builtin shortcuts", () => {
  const config = { debug: false, shortcuts: { avoidBuiltinConflicts: true, pasteImage: ["escape"] } };
  const shortcuts = getImagePasteShortcuts(config, process.platform);
  assert.deepEqual(shortcuts, []);
});

test("suppressBuiltinConflictWarnings implies conflict avoidance", () => {
  const config = { debug: false, shortcuts: { avoidBuiltinConflicts: false, suppressBuiltinConflictWarnings: true, pasteImage: ["escape"] } };
  const shortcuts = getImagePasteShortcuts(config, process.platform);
  assert.deepEqual(shortcuts, []);
});

test("parseBoolean rejects string true", () => {
  const fixture = createTempRoot();
  try {
    const configPath = join(fixture.root, "config.json");
    writeJson(configPath, { debug: "true" });
    assert.throws(() => loadImageToolsConfig(configPath, { platform: "linux" }), /expected a boolean/);
  } finally {
    fixture.cleanup();
  }
});

test("parseBoolean rejects number", () => {
  const fixture = createTempRoot();
  try {
    const configPath = join(fixture.root, "config.json");
    writeJson(configPath, { debug: 1 });
    assert.throws(() => loadImageToolsConfig(configPath, { platform: "linux" }), /expected a boolean/);
  } finally {
    fixture.cleanup();
  }
});

test("normalizeShortcut rejects non-string", () => {
  const fixture = createTempRoot();
  try {
    const configPath = join(fixture.root, "config.json");
    writeJson(configPath, { debug: false, shortcuts: { pasteImage: [42] } });
    assert.throws(() => loadImageToolsConfig(configPath, { platform: "linux" }), /expected a string shortcut/);
  } finally {
    fixture.cleanup();
  }
});

test("parseShortcutList deduplicates case-insensitively", () => {
  const fixture = createTempRoot();
  try {
    const configPath = join(fixture.root, "config.json");
    writeJson(configPath, { debug: false, shortcuts: { pasteImage: ["Ctrl+V", "ctrl+v", "alt+v"] } });
    const cfg = loadImageToolsConfig(configPath, { platform: "linux" });
    assert.deepEqual(cfg.shortcuts.pasteImage, ["Ctrl+V", "alt+v"]);
  } finally {
    fixture.cleanup();
  }
});

test("parseShortcutList accepts string shorthand", () => {
  const fixture = createTempRoot();
  try {
    const configPath = join(fixture.root, "config.json");
    writeJson(configPath, { debug: false, shortcuts: { pasteImage: "ctrl+v" } });
    const cfg = loadImageToolsConfig(configPath, { platform: "linux" });
    assert.deepEqual(cfg.shortcuts.pasteImage, ["ctrl+v"]);
  } finally {
    fixture.cleanup();
  }
});

test("parseShortcutList accepts empty array", () => {
  const fixture = createTempRoot();
  try {
    const configPath = join(fixture.root, "config.json");
    writeJson(configPath, { debug: false, shortcuts: { pasteImage: [] } });
    const cfg = loadImageToolsConfig(configPath, { platform: "linux" });
    assert.deepEqual(cfg.shortcuts.pasteImage, []);
  } finally {
    fixture.cleanup();
  }
});

test("loadImageToolsConfig returns defaults when file missing", () => {
  const fixture = createTempRoot();
  try {
    const configPath = join(fixture.root, "nonexistent.json");
    const cfg = loadImageToolsConfig(configPath, { platform: "darwin" });
    assert.equal(cfg.shortcuts.avoidBuiltinConflicts, true);
    assert.deepEqual(cfg.shortcuts.pasteImage, undefined);
  } finally {
    fixture.cleanup();
  }
});

test("loadImageToolsConfig returns defaults when shortcuts undefined", () => {
  const fixture = createTempRoot();
  try {
    const configPath = join(fixture.root, "config.json");
    writeJson(configPath, { debug: false });
    const cfg = loadImageToolsConfig(configPath, { platform: "linux" });
    assert.equal(cfg.shortcuts.avoidBuiltinConflicts, true);
    assert.deepEqual(cfg.shortcuts.pasteImage, undefined);
  } finally {
    fixture.cleanup();
  }
});

test("loadImageToolsConfig throws on malformed JSON", () => {
  const fixture = createTempRoot();
  try {
    const configPath = join(fixture.root, "config.json");
    writeFileSync(configPath, "{ not json", "utf8");
    assert.throws(() => loadImageToolsConfig(configPath, { platform: "linux" }), /Invalid pi-image-tools config/);
  } finally {
    fixture.cleanup();
  }
});

test("windows candidates include alt+v and ctrl+alt+v when conflicts disabled", () => {
  const config = { debug: false, shortcuts: { avoidBuiltinConflicts: false } };
  const shortcuts = getImagePasteShortcuts(config, "win32");
  assert.ok(shortcuts.includes("alt+v"));
  assert.ok(shortcuts.includes("ctrl+alt+v"));
});

test("linux candidates include ctrl+v when conflicts disabled", () => {
  const config = { debug: false, shortcuts: { avoidBuiltinConflicts: false } };
  const shortcuts = getImagePasteShortcuts(config, "linux");
  assert.ok(shortcuts.includes("ctrl+v"));
});

test("default shortcuts restore primary paste shortcut when Pi's built-in binding is disabled", () => {
  const fixture = createTempRoot();
  const configPath = join(fixture.root, "config.json");
  const keybindingsPath = join(fixture.root, "keybindings.json");

  try {
    writeJson(configPath, { debug: false });
    writeJson(keybindingsPath, { "app.clipboard.pasteImage": [] });

    withAgentDir(fixture.root, () => {
      const macConfig = loadImageToolsConfig(configPath, { platform: "darwin" });
      const windowsConfig = loadImageToolsConfig(configPath, { platform: "win32" });

      assert.deepEqual(getImagePasteShortcuts(macConfig, "darwin"), ["ctrl+v", "alt+v", "ctrl+alt+v"]);
      assert.deepEqual(getImagePasteShortcuts(windowsConfig, "win32"), ["alt+v", "ctrl+alt+v"]);
    });
  } finally {
    fixture.cleanup();
  }
});

test("normalizeShortcut trims whitespace", () => {
  const fixture = createTempRoot();
  try {
    const configPath = join(fixture.root, "config.json");
    writeJson(configPath, { debug: false, shortcuts: { pasteImage: [" ctrl+v "] } });
    const cfg = loadImageToolsConfig(configPath, { platform: "linux" });
    assert.deepEqual(cfg.shortcuts.pasteImage, ["ctrl+v"]);
  } finally {
    fixture.cleanup();
  }
});

test("buildNamespaceWrappedCommand swallows commandExists exceptions and returns unwrapped", () => {
  const result = buildNamespaceWrappedCommand(
    "osascript",
    ["-e", "test"],
    { platform: "darwin", environment: { TMUX: "/tmp/tmux" } },
    () => { throw new Error("simulated crash"); },
  );
  assert.deepEqual(result, { command: "osascript", args: ["-e", "test"], wrapped: false });
});

test("macOS pngpaste provider isAvailable returns false when commandExists throws", () => {
  const provider = new PngpasteProvider({
    commandExists: () => { throw new Error("crash"); },
  });
  assert.equal(provider.isAvailable({ platform: "darwin", environment: {} }), false);
});

test("macOS osascript public.png provider isAvailable returns false when commandExists throws", () => {
  const provider = new OsascriptPublicPngProvider({
    commandExists: () => { throw new Error("crash"); },
  });
  assert.equal(provider.isAvailable({ platform: "darwin", environment: {} }), false);
});

test("macOS osascript PNGf provider isAvailable returns false when commandExists throws", () => {
  const provider = new OsascriptPngfProvider({
    commandExists: () => { throw new Error("crash"); },
  });
  assert.equal(provider.isAvailable({ platform: "darwin", environment: {} }), false);
});

test.after(() => {
  rmSync(TEST_DIST_DIR, { recursive: true, force: true });
});

test("provider registry sorts eligible providers and stops after first image", async () => {
  const calls = [];
  const registry = new ClipboardProviderRegistry([
    createMockProvider({ id: "late", priority: 30, calls }),
    createMockProvider({ id: "unavailable", priority: 5, available: false, calls }),
    createMockProvider({
      id: "winner",
      priority: 20,
      result: { available: true, image: { bytes: new Uint8Array([1]), mimeType: "image/png" } },
      calls,
    }),
    createMockProvider({ id: "first", priority: 10, calls }),
  ]);
  const context = { platform: "darwin", environment: {} };

  const eligible = await registry.getEligible(context);
  assert.deepEqual(eligible.map((provider) => provider.capabilities.id), ["first", "winner", "late"]);

  const result = await registry.read(context);
  assert.deepEqual(calls, ["first", "winner"]);
  assert.equal(result.image?.mimeType, "image/png");
  assert.deepEqual(result.attempts.map((attempt) => attempt.providerId), ["unavailable", "first", "winner"]);
  assert.equal(result.attempts[0].skipped, true);
});

test("provider registry returns null when available providers find no image", async () => {
  const registry = new ClipboardProviderRegistry([
    createMockProvider({ id: "one", priority: 10 }),
    createMockProvider({ id: "two", priority: 20 }),
  ]);

  const result = await registry.read({ platform: "linux", environment: { DISPLAY: ":0" } });
  assert.equal(result.image, null);
  assert.equal(result.attempts.some((attempt) => attempt.available), true);
});

test("macOS pngpaste provider wraps spawned command under tmux when namespace helper exists", async () => {
  const calls = [];
  const provider = new PngpasteProvider({
    commandExists: (command) => command === "pngpaste" || command === "reattach-to-user-namespace",
    commandRunner(command, args, options) {
      calls.push({ command, args: [...args], options });
      return commandResult({ stdout: PNG_BYTES });
    },
  });

  const image = await provider.read({ platform: "darwin", environment: { TMUX: "/tmp/tmux" } });
  assert.equal(image.available, true);
  assert.deepEqual(Array.from(image.image.bytes), Array.from(PNG_BYTES));
  assert.equal(calls[0].command, "reattach-to-user-namespace");
  assert.deepEqual(calls[0].args, ["pngpaste", "-"]);
  assert.equal(calls[0].options.timeout, 5000);
});

test("macOS pngpaste provider reports unavailable when command is missing", async () => {
  const provider = new PngpasteProvider({
    commandExists: () => false,
    commandRunner() {
      return commandResult({ ok: false, missingCommand: true });
    },
  });

  const result = await provider.read({ platform: "darwin", environment: {} });
  assert.equal(result.available, false);
  assert.equal(result.image, null);
});

test("macOS osascript public.png provider selects JXA pasteboard command", async () => {
  const calls = [];
  const provider = new OsascriptPublicPngProvider({
    commandExists: (command) => command === "osascript",
    commandRunner(command, args) {
      calls.push({ command, args: [...args] });
      return commandResult({ stdout: PNG_BYTES });
    },
  });

  const result = await provider.read({ platform: "darwin", environment: {} });
  assert.equal(result.image.mimeType, "image/png");
  assert.equal(calls[0].command, "osascript");
  assert.deepEqual(calls[0].args.slice(0, 3), ["-l", "JavaScript", "-e"]);
  assert.match(calls[0].args[3], /public\.png/);
});

test("macOS osascript PNGf provider parses AppleScript data output", async () => {
  const calls = [];
  const provider = new OsascriptPngfProvider({
    commandExists: (command) => command === "osascript",
    commandRunner(command, args) {
      calls.push({ command, args: [...args] });
      return commandResult({ stdout: Buffer.from("«data PNGf89504E470D0A1A0A»\n", "utf8") });
    },
  });

  const result = await provider.read({ platform: "darwin", environment: {} });
  assert.equal(result.image.mimeType, "image/png");
  assert.deepEqual(Array.from(result.image.bytes), Array.from(PNG_BYTES));
  assert.equal(calls[0].command, "osascript");
  assert.match(calls[0].args.join(" "), /PNGf/);
});

test("shell environment detects tmux and only wraps darwin commands when helper exists", () => {
  assert.equal(isTmuxSession({ TMUX: "/tmp/tmux" }), true);
  assert.equal(isTmuxSession({}), false);

  const wrapped = buildNamespaceWrappedCommand(
    "osascript",
    ["-e", "return 1"],
    { platform: "darwin", environment: { TMUX: "/tmp/tmux" } },
    () => true,
  );
  assert.deepEqual(wrapped, {
    command: "reattach-to-user-namespace",
    args: ["osascript", "-e", "return 1"],
    wrapped: true,
  });

  const linux = buildNamespaceWrappedCommand(
    "osascript",
    ["-e", "return 1"],
    { platform: "linux", environment: { TMUX: "/tmp/tmux" } },
    () => true,
  );
  assert.deepEqual(linux, { command: "osascript", args: ["-e", "return 1"], wrapped: false });

  const missingHelper = buildNamespaceWrappedCommand(
    "osascript",
    ["-e", "return 1"],
    { platform: "darwin", environment: { TMUX: "/tmp/tmux" } },
    () => false,
  );
  assert.deepEqual(missingHelper, { command: "osascript", args: ["-e", "return 1"], wrapped: false });
});

test("default shortcuts avoid built-in conflicts on all platforms", () => {
  const fixture = createTempRoot();
  const configPath = join(fixture.root, "config.json");

  try {
    writeJson(configPath, { debug: false, shortcuts: {}, clipboard: { unknownFutureField: true } });

    withAgentDir(fixture.root, () => {
      const macConfig = loadImageToolsConfig(configPath, { platform: "darwin" });
      const linuxConfig = loadImageToolsConfig(configPath, { platform: "linux" });
      const windowsConfig = loadImageToolsConfig(configPath, { platform: "win32" });

      assert.equal(macConfig.shortcuts.avoidBuiltinConflicts, true);
      assert.equal(linuxConfig.shortcuts.avoidBuiltinConflicts, true);
      assert.equal(windowsConfig.shortcuts.avoidBuiltinConflicts, true);
      assert.equal(macConfig.shortcuts.suppressBuiltinConflictWarnings, false);
      assert.deepEqual(getImagePasteShortcuts(macConfig, "darwin"), ["alt+v", "ctrl+alt+v"]);
      assert.deepEqual(getImagePasteShortcuts(linuxConfig, "linux"), ["alt+v", "ctrl+alt+v"]);
      assert.deepEqual(getImagePasteShortcuts(windowsConfig, "win32"), ["ctrl+alt+v"]);
    });
  } finally {
    fixture.cleanup();
  }
});
