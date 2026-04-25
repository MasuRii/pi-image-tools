import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

const { buildPreviewItems } = imagePreviewModule;
const {
  DEFAULT_TERMINAL_IMAGE_WIDTH_CELLS,
  resolveTerminalImageWidthCells,
  setActiveTerminalImageSettingsCwd,
} = terminalWidthModule;

const originalCwd = process.cwd();

test.after(() => {
  setActiveTerminalImageSettingsCwd(originalCwd);
  rmSync(TEST_DIST_DIR, { recursive: true, force: true });
});

test("buildPreviewItems honors project terminal.imageWidthCells overrides", () => {
  const fixture = createFixture();

  try {
    writeJson(join(fixture.agentDir, "settings.json"), {
      terminal: { imageWidthCells: 64 },
    });
    writeJson(join(fixture.projectDir, ".pi", "settings.json"), {
      terminal: { imageWidthCells: 93 },
    });

    const items = withEnv({ [DISABLE_SIXEL_ENV]: "1" }, () =>
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

test("buildPreviewItems uses the active session cwd when no explicit options are passed", () => {
  const fixture = createFixture();

  try {
    writeJson(join(fixture.projectDir, ".pi", "settings.json"), {
      terminal: { imageWidthCells: 77 },
    });

    const items = withEnv(
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
