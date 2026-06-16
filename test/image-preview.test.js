import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const EXTENSION_ROOT = fileURLToPath(new URL("..", import.meta.url));
const TEST_DIST_DIR = join(EXTENSION_ROOT, ".test-dist");
const TSCONFIG_PATH = join(TEST_DIST_DIR, "tsconfig.test.json");
const NPX_COMMAND = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "npx";
const SAMPLE_IMAGE = {
  type: "image",
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2ioAAAAASUVORK5CYII=",
  mimeType: "image/png",
};
const DEFAULT_AGENT_ENV = "PI_CODING_AGENT_DIR";
const DISABLE_SIXEL_ENV = "PI_IMAGE_TOOLS_DISABLE_SIXEL";
const FORCE_SIXEL_ENV = "PI_IMAGE_TOOLS_FORCE_SIXEL";

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
        exclude: ["../node_modules", "../.test-dist", "../test"],
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );

  const commandArgs =
    process.platform === "win32"
      ? [
          "/d",
          "/s",
          "/c",
          `npx --yes -p typescript@5.7.3 tsc -p ${TSCONFIG_PATH}`,
        ]
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

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "pi-image-tools-test-"));
  const agentDir = join(root, "agent");
  const projectDir = join(root, "project");

  mkdirSync(agentDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });

  return {
    agentDir,
    projectDir,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function withEnv(overrides, run) {
  const previous = new Map();

  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return run();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

compileTestModules();

const imagePreviewModule = await import(pathToFileURL(join(TEST_DIST_DIR, "src", "image-preview.js")).href);
const terminalWidthModule = await import(
  pathToFileURL(join(TEST_DIST_DIR, "src", "terminal-image-width.js")).href
);
const imageMimeModule = await import(pathToFileURL(join(TEST_DIST_DIR, "src", "image-mime.js")).href);
const clipboardModule = await import(pathToFileURL(join(TEST_DIST_DIR, "src", "clipboard.js")).href);
const recentImagesModule = await import(pathToFileURL(join(TEST_DIST_DIR, "src", "recent-images.js")).href);
const sixelProtocolModule = await import(pathToFileURL(join(TEST_DIST_DIR, "src", "sixel-protocol.js")).href);
const inlineUserPreviewModule = await import(pathToFileURL(join(TEST_DIST_DIR, "src", "inline-user-preview.js")).href);
const codingAgentModule = await import("@earendil-works/pi-coding-agent");

const { buildPreviewItems } = imagePreviewModule;
const { getBase64DecodedByteLength } = await import(pathToFileURL(join(TEST_DIST_DIR, "src", "image-size.js")).href);
const {
  DEFAULT_TERMINAL_IMAGE_WIDTH_CELLS,
  resolveTerminalImageWidthCells,
  setActiveTerminalImageSettingsCwd,
} = terminalWidthModule;
const { extensionToMimeType, mimeTypeToExtension, normalizeMimeType, selectPreferredImageMimeType } = imageMimeModule;
const { hasGraphicalSession, readClipboardImage } = clipboardModule;
const { discoverRecentImages, persistImageToRecentCache, loadRecentImage } = recentImagesModule;
const { ensureCompleteSixelSequence } = sixelProtocolModule;
const { registerInlineUserImagePreview } = inlineUserPreviewModule;
const { InteractiveMode, UserMessageComponent } = codingAgentModule;

const originalCwd = process.cwd();

test.after(() => {
  setActiveTerminalImageSettingsCwd(originalCwd);
  rmSync(TEST_DIST_DIR, { recursive: true, force: true });
});

test("buildPreviewItems honors project terminal.imageWidthCells overrides", async () => {
  const fixture = createFixture();

  try {
    writeJson(join(fixture.agentDir, "settings.json"), {
      terminal: { imageWidthCells: 64 },
    });
    writeJson(join(fixture.projectDir, ".pi", "settings.json"), {
      terminal: { imageWidthCells: 93 },
    });

    const items = await withEnv({ [DISABLE_SIXEL_ENV]: "1" }, () =>
      buildPreviewItems([SAMPLE_IMAGE], {
        cwd: fixture.projectDir,
        agentDir: fixture.agentDir,
      }),
    );

    assert.equal(items.length, 1);
    assert.equal(items[0].protocol, "native");
    assert.equal(items[0].maxWidthCells, 93);
  } finally {
    fixture.cleanup();
  }
});

test("buildPreviewItems uses the active session cwd when no explicit options are passed", async () => {
  const fixture = createFixture();

  try {
    writeJson(join(fixture.projectDir, ".pi", "settings.json"), {
      terminal: { imageWidthCells: 77 },
    });

    const items = await withEnv(
      {
        [DEFAULT_AGENT_ENV]: fixture.agentDir,
        [DISABLE_SIXEL_ENV]: "1",
      },
      () => {
        setActiveTerminalImageSettingsCwd(fixture.projectDir);
        return buildPreviewItems([SAMPLE_IMAGE]);
      },
    );

    assert.equal(items.length, 1);
    assert.equal(items[0].maxWidthCells, 77);
  } finally {
    setActiveTerminalImageSettingsCwd(originalCwd);
    fixture.cleanup();
  }
});

test("resolveTerminalImageWidthCells falls back to the documented default for invalid settings values", () => {
  const fixture = createFixture();

  try {
    writeJson(join(fixture.agentDir, "settings.json"), {
      terminal: { imageWidthCells: "wide" },
    });

    const width = resolveTerminalImageWidthCells({
      cwd: fixture.projectDir,
      agentDir: fixture.agentDir,
    });

    assert.equal(width, DEFAULT_TERMINAL_IMAGE_WIDTH_CELLS);
  } finally {
    fixture.cleanup();
  }
});


test("buildPreviewItems injects the Windows PowerShell sixel runner without spawning PowerShell", async () => {
  const calls = [];
  const powerShellRunner = (script, options) => {
    calls.push({ script, options });
    if (script.includes("Get-Module -ListAvailable -Name Sixel")) {
      return Promise.resolve({
        ok: true,
        stdout: "Sixel/1.2.3\n",
        stderr: "",
        missingCommand: false,
      });
    }

    assert.match(script, /ConvertTo-Sixel/);
    return Promise.resolve({
      ok: true,
      stdout: "q\"1;1;1;1#0~~",
      stderr: "",
      missingCommand: false,
    });
  };

  const items = await buildPreviewItems([SAMPLE_IMAGE], {
    environment: { [FORCE_SIXEL_ENV]: "1" },
    platform: "win32",
    sixelPowerShellRunner: powerShellRunner,
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.timeout, 120_000);
  assert.equal(calls[1].options.maxBuffer, 128 * 1024 * 1024);
  assert.equal(items.length, 1);
  assert.equal(items[0].protocol, "sixel");
  assert.equal(items[0].sixelSequence, "\x1bPq\"1;1;1;1#0~~\x1b\\");
});


test("buildPreviewItems waits asynchronously for sixel conversion timeout fallback", async () => {
  let finishConversion;
  let settled = false;
  const calls = [];
  const runner = (command, args, options) => {
    calls.push({ command, args: [...args], options });
    if (args[0] === "--version") {
      return Promise.resolve({
        status: 0,
        stdout: Buffer.from("img2sixel 1.10.3\n"),
        stderr: Buffer.alloc(0),
      });
    }

    return new Promise((resolve) => {
      finishConversion = () =>
        resolve({
          status: null,
          stdout: Buffer.alloc(0),
          stderr: Buffer.alloc(0),
          error: Object.assign(new Error("spawn img2sixel ETIMEDOUT"), { code: "ETIMEDOUT" }),
        });
    });
  };

  const previewPromise = buildPreviewItems([SAMPLE_IMAGE], {
    environment: { [FORCE_SIXEL_ENV]: "1" },
    platform: "linux",
    sixelProcessRunner: runner,
  });
  previewPromise.then(() => {
    settled = true;
  });

  await Promise.resolve();
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].args.length, 1);
  assert.equal(calls[1].options.timeout, 120_000);
  assert.equal(calls[1].options.maxBuffer, 128 * 1024 * 1024);

  finishConversion();
  const items = await previewPromise;
  assert.equal(items.length, 1);
  assert.equal(items[0].protocol, "native");
  assert.match(items[0].warning, /ETIMEDOUT/);
});


test("Sixel protocol normalization wraps bare converter output as complete DCS", () => {
  const normalized = ensureCompleteSixelSequence("q\"1;1;1;1#0~~\n");

  assert.equal(normalized.startsWith("\x1bPq"), true);
  assert.equal(normalized.endsWith("\x1b\\"), true);
  assert.equal(normalized.includes("\n"), false);
  assert.equal(ensureCompleteSixelSequence("abc"), "\x1bPqabc\x1b\\");
  assert.equal(ensureCompleteSixelSequence(""), "");
});

test("shared image MIME utilities normalize parameters and preserve preferred mappings", () => {
  assert.equal(normalizeMimeType(" Image/PNG ; charset=binary "), "image/png");
  assert.equal(selectPreferredImageMimeType(["text/plain", "image/jpeg; quality=1"]), "image/jpeg; quality=1");
  assert.equal(extensionToMimeType(".jpeg"), "image/jpeg");
  assert.equal(mimeTypeToExtension("image/bmp; charset=binary"), "bmp");
});

test("Linux clipboard reader requires a graphical session before probing readers", async () => {
  assert.equal(hasGraphicalSession("linux", {}), false);
  assert.equal(hasGraphicalSession("linux", { DISPLAY: ":0" }), true);
  assert.equal(hasGraphicalSession("linux", { WAYLAND_DISPLAY: "wayland-0" }), true);
  assert.equal(hasGraphicalSession("win32", {}), true);

  await assert.rejects(
    () => readClipboardImage({ platform: "linux", environment: {} }),
    /requires a graphical desktop session/,
  );
});

test("Linux recent-image discovery includes cache and desktop screenshot defaults", () => {
  const fixture = createFixture();
  const cacheDirectory = join(fixture.projectDir, "cache");

  try {
    const discovery = discoverRecentImages({
      platform: "linux",
      homeDirectory: fixture.projectDir,
      environment: { PI_IMAGE_TOOLS_RECENT_CACHE_DIR: cacheDirectory },
    });

    assert.deepEqual(discovery.searchedDirectories, [
      cacheDirectory,
      join(fixture.projectDir, "Pictures", "Screenshots"),
      join(fixture.projectDir, "Pictures"),
      join(fixture.projectDir, "Downloads"),
      join(fixture.projectDir, "Desktop"),
    ]);
  } finally {
    fixture.cleanup();
  }
});

test("recent-cache pruning preserves non-extension-owned image files", () => {
  const fixture = createFixture();
  const cacheDirectory = join(fixture.projectDir, "cache");
  const oldOwnedFile = join(
    cacheDirectory,
    "pi-recent-1-00000000-0000-4000-8000-000000000000.png",
  );
  const userFile = join(cacheDirectory, "family.png");

  try {
    mkdirSync(cacheDirectory, { recursive: true });
    writeFileSync(oldOwnedFile, Buffer.from([1]));
    writeFileSync(userFile, Buffer.from([2]));
    const oldDate = new Date("2026-01-01T00:00:00Z");
    utimesSync(oldOwnedFile, oldDate, oldDate);
    utimesSync(userFile, oldDate, oldDate);

    const createdFile = persistImageToRecentCache(
      { bytes: new Uint8Array([3]), mimeType: "image/png" },
      {
        maxCacheFiles: 1,
        environment: { PI_IMAGE_TOOLS_RECENT_CACHE_DIR: cacheDirectory },
      },
    );

    assert.equal(existsSync(createdFile), true);
    assert.equal(existsSync(oldOwnedFile), false);
    assert.equal(existsSync(userFile), true);
  } finally {
    fixture.cleanup();
  }
});

test("recent image attachment loads enforce the configured max image byte limit", () => {
  const fixture = createFixture();
  const imagePath = join(fixture.projectDir, "oversized.png");

  try {
    writeFileSync(imagePath, Buffer.from([1, 2]));

    assert.throws(
      () =>
        loadRecentImage(
          {
            path: imagePath,
            name: "oversized.png",
            mimeType: "image/png",
            modifiedAtMs: Date.now(),
            sizeBytes: 2,
          },
          { PI_IMAGE_TOOLS_MAX_IMAGE_BYTES: "1" },
        ),
      /Recent image oversized\.png is too large/,
    );
  } finally {
    fixture.cleanup();
  }
});

test("recent image attachment loads re-check actual bytes when candidate metadata is stale", () => {
  const fixture = createFixture();
  const imagePath = join(fixture.projectDir, "stale-size.png");

  try {
    writeFileSync(imagePath, Buffer.from([1, 2]));

    assert.throws(
      () =>
        loadRecentImage(
          {
            path: imagePath,
            name: "stale-size.png",
            mimeType: "image/png",
            modifiedAtMs: Date.now(),
            sizeBytes: 1,
          },
          { PI_IMAGE_TOOLS_MAX_IMAGE_BYTES: "1" },
        ),
      /Recent image stale-size\.png is too large/,
    );
  } finally {
    fixture.cleanup();
  }
});

test("base64 byte length rejects malformed image payloads with impossible padding", () => {
  // ASSUMED: preview size validation should not undercount malformed base64 that
  // Node would still decode into bytes, otherwise max-image-byte enforcement can
  // be bypassed before preview conversion.
  assert.equal(getBase64DecodedByteLength("===="), Buffer.from("====", "base64").length);
});

test("inline user preview schedules session patches and adds preview below latest user message", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const interactivePrototype = InteractiveMode.prototype;
  const userMessagePrototype = UserMessageComponent.prototype;
  const originalAddMessageToChat = interactivePrototype.addMessageToChat;
  const originalGetUserMessageText = interactivePrototype.getUserMessageText;
  const originalPreviewPatched = interactivePrototype.__piImageToolsPreviewPatched;
  const originalOriginalAdd = interactivePrototype.__piImageToolsOriginalAddMessageToChat;
  const originalOriginalGet = interactivePrototype.__piImageToolsOriginalGetUserMessageText;
  const originalRender = userMessagePrototype.render;
  const originalInlinePatched = userMessagePrototype.__piImageToolsInlinePatched;
  const originalInlineRender = userMessagePrototype.__piImageToolsInlineOriginalRender;
  const handlers = new Map();
  const scheduled = [];

  try {
    delete interactivePrototype.__piImageToolsPreviewPatched;
    delete interactivePrototype.__piImageToolsOriginalAddMessageToChat;
    delete interactivePrototype.__piImageToolsOriginalGetUserMessageText;
    delete userMessagePrototype.__piImageToolsInlinePatched;
    delete userMessagePrototype.__piImageToolsInlineOriginalRender;
    interactivePrototype.getUserMessageText = () => "";
    interactivePrototype.addMessageToChat = function addMessageFixture() {
      this.chatContainer.children.push(Object.create(userMessagePrototype));
    };
    userMessagePrototype.render = () => ["base message"];
    globalThis.setTimeout = (callback, delayMs) => {
      scheduled.push({ callback, delayMs });
      return { unref() {} };
    };

    registerInlineUserImagePreview({ on: (event, handler) => handlers.set(event, handler) });
    await handlers.get("session_start")?.({}, { cwd: originalCwd });
    assert.deepEqual(scheduled.map((entry) => entry.delayMs), [0, 25]);

    for (const entry of scheduled) {
      entry.callback();
    }

    const mode = Object.create(interactivePrototype);
    mode.chatContainer = { children: [] };
    const message = { role: "user", content: [SAMPLE_IMAGE] };
    assert.equal(mode.getUserMessageText(message), "[󰈟 1 image attached]");

    withEnv({ [DISABLE_SIXEL_ENV]: "1" }, () => {
      mode.addMessageToChat(message);
    });
    await Promise.resolve();
    const child = mode.chatContainer.children[0];
    const preview = mode.chatContainer.children[1];
    assert.equal(child instanceof UserMessageComponent, true);
    assert.equal(mode.chatContainer.children.length, 2);
    assert.ok(preview.render(40).includes("↳ pasted image preview"));
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    interactivePrototype.addMessageToChat = originalAddMessageToChat;
    interactivePrototype.getUserMessageText = originalGetUserMessageText;
    userMessagePrototype.render = originalRender;
    if (originalPreviewPatched === undefined) delete interactivePrototype.__piImageToolsPreviewPatched;
    else interactivePrototype.__piImageToolsPreviewPatched = originalPreviewPatched;
    if (originalOriginalAdd === undefined) delete interactivePrototype.__piImageToolsOriginalAddMessageToChat;
    else interactivePrototype.__piImageToolsOriginalAddMessageToChat = originalOriginalAdd;
    if (originalOriginalGet === undefined) delete interactivePrototype.__piImageToolsOriginalGetUserMessageText;
    else interactivePrototype.__piImageToolsOriginalGetUserMessageText = originalOriginalGet;
    if (originalInlinePatched === undefined) delete userMessagePrototype.__piImageToolsInlinePatched;
    else userMessagePrototype.__piImageToolsInlinePatched = originalInlinePatched;
    if (originalInlineRender === undefined) delete userMessagePrototype.__piImageToolsInlineOriginalRender;
    else userMessagePrototype.__piImageToolsInlineOriginalRender = originalInlineRender;
  }
});

test("recent-cache writes enforce the configured max image byte limit", () => {
  const fixture = createFixture();

  try {
    assert.throws(
      () =>
        persistImageToRecentCache(
          { bytes: new Uint8Array([1, 2]), mimeType: "image/png" },
          {
            environment: {
              PI_IMAGE_TOOLS_RECENT_CACHE_DIR: join(fixture.projectDir, "cache"),
              PI_IMAGE_TOOLS_MAX_IMAGE_BYTES: "1",
            },
          },
        ),
      /Cached image is too large/,
    );
  } finally {
    fixture.cleanup();
  }
});
