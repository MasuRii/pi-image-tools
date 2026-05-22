import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const EXTENSION_ROOT = fileURLToPath(new URL("..", import.meta.url));
const TEST_DIST_DIR = join(EXTENSION_ROOT, ".test-debug-dist");
const TSCONFIG_PATH = join(TEST_DIST_DIR, "tsconfig.test.json");
const NPX_COMMAND = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "npx";
const DEBUG_CONFIG = {
  shortcuts: {
    avoidBuiltinConflicts: false,
    suppressBuiltinConflictWarnings: false,
  },
};

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
        include: ["../src/debug-logger.ts", "../src/config.ts"],
        exclude: ["../node_modules", "../.test-debug-dist", "../test"],
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

async function withTempRoot(run) {
  const root = mkdtempSync(join(tmpdir(), "pi-image-tools-debug-"));
  try {
    await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

compileTestModules();
const { DebugLogger } = await import(pathToFileURL(join(TEST_DIST_DIR, "src", "debug-logger.js")).href);

test.after(() => {
  rmSync(TEST_DIST_DIR, { recursive: true, force: true });
});

test("disabled debug logger is a no-op and does not create debug artifacts", async () => {
  await withTempRoot(async (root) => {
    const logger = DebugLogger.create({ ...DEBUG_CONFIG, debug: false }, { extensionRoot: root });

    logger.log("disabled", { apiKey: "secret" });
    await logger.flush();

    assert.equal(existsSync(join(root, "debug")), false);
  });
});

test("enabled debug logger writes on flush and redacts secret fields", async () => {
  await withTempRoot(async (root) => {
    const logger = DebugLogger.create({ ...DEBUG_CONFIG, debug: true }, { extensionRoot: root });

    assert.equal(logger.log("preview", {
      apiKey: "secret-key",
      nested: { token: "secret-token", safe: "visible" },
    }), undefined);
    assert.equal(existsSync(join(root, "debug")), false, "write should be scheduled asynchronously");
    await logger.flush();

    const logContent = readFileSync(join(root, "debug", "debug.log"), "utf-8");
    assert.match(logContent, /"event":"preview"/);
    assert.match(logContent, /"apiKey":"\[REDACTED\]"/);
    assert.match(logContent, /"token":"\[REDACTED\]"/);
    assert.match(logContent, /"safe":"visible"/);
    assert.doesNotMatch(logContent, /secret-key|secret-token/);
  });
});

test("debug logger swallows filesystem failures", async () => {
  await withTempRoot(async (root) => {
    writeFileSync(join(root, "debug"), "not a directory", "utf-8");
    const logger = DebugLogger.create({ ...DEBUG_CONFIG, debug: true }, { extensionRoot: root });

    assert.doesNotThrow(() => logger.log("write-fails", { password: "secret" }));
    await assert.doesNotReject(() => logger.flush());
  });
});
