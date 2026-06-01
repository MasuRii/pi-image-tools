import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const EXTENSION_ROOT = fileURLToPath(new URL("..", import.meta.url));
const TEST_DIST_DIR = join(EXTENSION_ROOT, ".test-transcode-dist");
const TSCONFIG_PATH = join(TEST_DIST_DIR, "tsconfig.test.json");
const NPX_COMMAND = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "npx";
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BMP_BYTES = Buffer.from([0x42, 0x4d, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

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
        exclude: ["../node_modules", "../.test-transcode-dist", "../test"],
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

compileTestModules();

const { transcodeToSupportedFormat, MODEL_PROVIDER_IMAGE_MIME_TYPES } = await import(
  pathToFileURL(join(TEST_DIST_DIR, "src", "image-transcode.js")).href
);

function makeRunner(impl) {
  const calls = [];
  const runner = (command, args, input) => {
    calls.push({ command, args: [...args], inputLength: input.length });
    return impl(command, args, input);
  };
  return { runner, calls };
}

test("transcodeToSupportedFormat returns supported MIME types unchanged", () => {
  const { runner, calls } = makeRunner(() => {
    throw new Error("should not be called");
  });
  const image = { bytes: new Uint8Array(PNG_BYTES), mimeType: "image/png" };
  const result = transcodeToSupportedFormat(image, { runner });
  assert.equal(result, image);
  assert.equal(calls.length, 0);
});

test("transcodeToSupportedFormat canonicalizes parameterized supported MIME types without re-encoding", () => {
  const { runner, calls } = makeRunner(() => {
    throw new Error("should not be called");
  });
  const image = { bytes: new Uint8Array(PNG_BYTES), mimeType: "IMAGE/PNG; charset=binary" };
  const result = transcodeToSupportedFormat(image, { runner });
  assert.equal(result.mimeType, "image/png");
  assert.equal(result.bytes, image.bytes, "bytes should be reused, not re-encoded");
  assert.equal(calls.length, 0);
});

test("transcodeToSupportedFormat upgrades the image/jpg alias to image/jpeg without re-encoding", () => {
  const { runner, calls } = makeRunner(() => {
    throw new Error("should not be called");
  });
  const image = { bytes: new Uint8Array([0xff, 0xd8, 0xff]), mimeType: "image/jpg" };
  const result = transcodeToSupportedFormat(image, { runner });
  assert.equal(result.mimeType, "image/jpeg");
  assert.equal(calls.length, 0);
});

test("transcodeToSupportedFormat invokes ImageMagick to convert image/bmp to image/png", () => {
  const { runner, calls } = makeRunner(() => ({
    status: 0,
    stdout: PNG_BYTES,
    stderr: Buffer.alloc(0),
    pid: 0,
    output: [],
    signal: null,
  }));
  const image = { bytes: new Uint8Array(BMP_BYTES), mimeType: "image/bmp" };
  const result = transcodeToSupportedFormat(image, { runner });
  assert.equal(result.mimeType, "image/png");
  assert.deepEqual(Buffer.from(result.bytes), PNG_BYTES);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "magick");
  assert.deepEqual(calls[0].args, ["bmp:-", "png:-"]);
  assert.equal(calls[0].inputLength, BMP_BYTES.length);
});

test("transcodeToSupportedFormat normalizes the source MIME before deriving the ImageMagick input format", () => {
  const { runner, calls } = makeRunner(() => ({
    status: 0,
    stdout: PNG_BYTES,
    stderr: Buffer.alloc(0),
    pid: 0,
    output: [],
    signal: null,
  }));
  transcodeToSupportedFormat(
    { bytes: new Uint8Array(BMP_BYTES), mimeType: "IMAGE/BMP; charset=binary" },
    { runner },
  );
  assert.deepEqual(calls[0].args, ["bmp:-", "png:-"]);
});

test("transcodeToSupportedFormat falls back to `convert` when `magick` is missing", () => {
  const { runner, calls } = makeRunner((command) => {
    if (command === "magick") {
      const error = Object.assign(new Error("spawn magick ENOENT"), { code: "ENOENT" });
      return { error, status: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), pid: 0, output: [], signal: null };
    }
    return { status: 0, stdout: PNG_BYTES, stderr: Buffer.alloc(0), pid: 0, output: [], signal: null };
  });
  const result = transcodeToSupportedFormat(
    { bytes: new Uint8Array(BMP_BYTES), mimeType: "image/bmp" },
    { runner },
  );
  assert.equal(result.mimeType, "image/png");
  assert.deepEqual(calls.map((c) => c.command), ["magick", "convert"]);
});

test("transcodeToSupportedFormat throws a helpful error when no ImageMagick binary is available", () => {
  const { runner } = makeRunner(() => {
    const error = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
    return { error, status: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), pid: 0, output: [], signal: null };
  });
  assert.throws(
    () => transcodeToSupportedFormat({ bytes: new Uint8Array(BMP_BYTES), mimeType: "image/bmp" }, { runner }),
    /unsupported format "image\/bmp".*ImageMagick/s,
  );
});

test("transcodeToSupportedFormat throws when ImageMagick exits non-zero", () => {
  const { runner } = makeRunner(() => ({
    status: 1,
    stdout: Buffer.alloc(0),
    stderr: Buffer.from("convert: unable to read image"),
    pid: 0,
    output: [],
    signal: null,
  }));
  assert.throws(
    () => transcodeToSupportedFormat({ bytes: new Uint8Array(BMP_BYTES), mimeType: "image/bmp" }, { runner }),
    /unable to read image|status 1/,
  );
});

test("MODEL_PROVIDER_IMAGE_MIME_TYPES matches the formats accepted by major model providers", () => {
  for (const mime of ["image/png", "image/jpeg", "image/gif", "image/webp"]) {
    assert.ok(MODEL_PROVIDER_IMAGE_MIME_TYPES.has(mime), `expected ${mime} to be supported`);
  }
  // image/jpg is intentionally not in the set; it is canonicalized to image/jpeg
  // before lookup so downstream consumers always see the IANA-canonical spelling.
  assert.ok(!MODEL_PROVIDER_IMAGE_MIME_TYPES.has("image/jpg"));
  assert.ok(!MODEL_PROVIDER_IMAGE_MIME_TYPES.has("image/bmp"));
  assert.ok(!MODEL_PROVIDER_IMAGE_MIME_TYPES.has("image/tiff"));
});

rmSync(TEST_DIST_DIR, { recursive: true, force: true });
