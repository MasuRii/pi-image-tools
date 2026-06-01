import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerPasteImageCommand } from "./commands.js";
import { loadImageToolsConfig } from "./config.js";
import { DebugLogger } from "./debug-logger.js";
import { getErrorMessage } from "./errors.js";
import { assertImageWithinByteLimit } from "./image-size.js";
import { registerImagePasteKeybindings } from "./keybindings.js";
import type { ClipboardImage, PasteContext } from "./types.js";

const IMAGE_ATTACHMENT_INDICATOR = "[󰈟 Image Attached]";
const IMAGE_PREVIEW_CUSTOM_TYPE = "pi-image-tools-preview";
const RECENT_IMAGE_ENV_VAR = "PI_IMAGE_TOOLS_RECENT_DIRS";
const RECENT_IMAGE_CACHE_DIR_ENV_VAR = "PI_IMAGE_TOOLS_RECENT_CACHE_DIR";

type ImagePayload = {
  type: "image";
  data: string;
  mimeType: string;
};

interface PendingImage extends ImagePayload {}

type ClipboardModule = typeof import("./clipboard.js");
type ImagePreviewModule = typeof import("./image-preview.js");
type InlineUserPreviewModule = typeof import("./inline-user-preview.js");
type RecentImagesModule = typeof import("./recent-images.js");

let clipboardModulePromise: Promise<ClipboardModule> | undefined;
let imagePreviewModulePromise: Promise<ImagePreviewModule> | undefined;
let inlineUserPreviewModulePromise: Promise<InlineUserPreviewModule> | undefined;
let recentImagesModulePromise: Promise<RecentImagesModule> | undefined;
const imagePreviewDisplayRegistrations = new WeakSet<ExtensionAPI>();
const inlineUserPreviewRegistrations = new WeakSet<ExtensionAPI>();
const previewRegistrationPromises = new WeakMap<ExtensionAPI, Promise<void>>();

function loadClipboardModule(): Promise<ClipboardModule> {
  clipboardModulePromise ??= import("./clipboard.js");
  return clipboardModulePromise;
}

function loadImagePreviewModule(): Promise<ImagePreviewModule> {
  imagePreviewModulePromise ??= import("./image-preview.js");
  return imagePreviewModulePromise;
}

function loadInlineUserPreviewModule(): Promise<InlineUserPreviewModule> {
  inlineUserPreviewModulePromise ??= import("./inline-user-preview.js");
  return inlineUserPreviewModulePromise;
}

function loadRecentImagesModule(): Promise<RecentImagesModule> {
  recentImagesModulePromise ??= import("./recent-images.js");
  return recentImagesModulePromise;
}

async function ensureImagePreviewDisplayRegistered(
  pi: ExtensionAPI,
  logger: DebugLogger,
): Promise<ImagePreviewModule> {
  const module = await loadImagePreviewModule();
  if (!imagePreviewDisplayRegistrations.has(pi)) {
    imagePreviewDisplayRegistrations.add(pi);
    module.registerImagePreviewDisplay(pi, { logger });
  }
  return module;
}

async function ensurePreviewRegistrations(pi: ExtensionAPI, logger: DebugLogger): Promise<void> {
  let registrationPromise = previewRegistrationPromises.get(pi);
  if (!registrationPromise) {
    registrationPromise = (async () => {
      await ensureImagePreviewDisplayRegistered(pi, logger);

      if (!inlineUserPreviewRegistrations.has(pi)) {
        const module = await loadInlineUserPreviewModule();
        inlineUserPreviewRegistrations.add(pi);
        module.registerInlineUserImagePreview(pi, { logger });
      }
    })();
    previewRegistrationPromises.set(pi, registrationPromise);
  }

  await registrationPromise;
}

function imageToBase64(image: ClipboardImage): string {
  assertImageWithinByteLimit(image.bytes.length, "Image attachment");
  return Buffer.from(image.bytes).toString("base64");
}

function countOccurrences(text: string, token: string): number {
  if (token.length === 0) {
    return 0;
  }

  let count = 0;
  let cursor = 0;
  while (cursor < text.length) {
    const index = text.indexOf(token, cursor);
    if (index === -1) {
      break;
    }

    count += 1;
    cursor = index + token.length;
  }

  return count;
}

function removeAttachmentIndicators(text: string): string {
  const withoutMarkers = text.split(IMAGE_ATTACHMENT_INDICATOR).join("");
  return withoutMarkers.replace(/\n{3,}/g, "\n\n").trim();
}

async function cacheImageForRecentPicker(ctx: PasteContext, image: ClipboardImage): Promise<void> {
  try {
    const { persistImageToRecentCache } = await loadRecentImagesModule();
    persistImageToRecentCache(image);
  } catch (error) {
    if (ctx.hasUI) {
      ctx.ui.notify(
        `Image attached, but failed to cache for /paste-image recent: ${getErrorMessage(error)}`,
        "warning",
      );
    }
  }
}

function queueImageAttachment(
  ctx: PasteContext,
  pendingImages: PendingImage[],
  image: ClipboardImage,
  successMessage: string,
  options: { cacheForRecentPicker?: boolean } = {},
): void {
  pendingImages.push({
    type: "image",
    data: imageToBase64(image),
    mimeType: image.mimeType,
  });

  if (options.cacheForRecentPicker) {
    void cacheImageForRecentPicker(ctx, image);
  }

  if (!ctx.hasUI) {
    return;
  }

  ctx.ui.pasteToEditor(`${IMAGE_ATTACHMENT_INDICATOR} `);
  ctx.ui.notify(successMessage, "info");
}

function buildRecentImageEmptyStateMessage(
  searchedDirectories: readonly string[],
  cacheDirectory: string,
): string {
  const searched =
    searchedDirectories.length > 0
      ? searchedDirectories.join("; ")
      : "No directories configured";

  return [
    `No recent images found. Searched: ${searched}`,
    `Clipboard-pasted images are cached in: ${cacheDirectory}`,
    `Set ${RECENT_IMAGE_ENV_VAR} to a semicolon-separated list of directories to override defaults.`,
    `Set ${RECENT_IMAGE_CACHE_DIR_ENV_VAR} to customize the cache directory.`,
  ].join(" ");
}

async function showRecentSelectionPreview(
  pi: ExtensionAPI,
  image: ClipboardImage,
  cwd: string,
  logger: DebugLogger,
): Promise<void> {
  const { buildPreviewItems } = await ensureImagePreviewDisplayRegistered(pi, logger);
  const previewItems = await buildPreviewItems(
    [
      {
        type: "image",
        data: imageToBase64(image),
        mimeType: image.mimeType,
      },
    ],
    { cwd, logger },
  );

  if (previewItems.length === 0) {
    return;
  }

  const previewMessage = {
    customType: IMAGE_PREVIEW_CUSTOM_TYPE,
    content: "",
    display: true,
    details: { items: previewItems },
  };

  setTimeout(() => {
    pi.sendMessage(previewMessage, { triggerTurn: false });
  }, 0);
}

export default function imageToolsExtension(pi: ExtensionAPI): void {
  const config = loadImageToolsConfig();
  const logger = DebugLogger.create(config);
  const pendingImages: PendingImage[] = [];

  logger.log("extension.initialize", {
    debug: config.debug,
    pasteImageShortcutsConfigured: config.shortcuts.pasteImage !== undefined,
  });

  pi.on("session_start", async (_event, ctx) => {
    try {
      const { setActiveTerminalImageSettingsCwd } = await import("./terminal-image-width.js");
      setActiveTerminalImageSettingsCwd(ctx.cwd);
      await ensurePreviewRegistrations(pi, logger);
    } catch (error) {
      logger.log("preview.lazy_registration_failed", { error: getErrorMessage(error) });
    }
  });

  const pasteImageFromClipboard = async (ctx: PasteContext): Promise<void> => {
    if (!ctx.hasUI) {
      return;
    }

    try {
      const { readClipboardImage } = await loadClipboardModule();
      const image = await readClipboardImage();
      if (!image) {
        ctx.ui.notify("No image found in clipboard.", "warning");
        return;
      }

      queueImageAttachment(
        ctx,
        pendingImages,
        image,
        "Image attached from clipboard. Add your message, then send. A terminal preview will render after submit.",
        { cacheForRecentPicker: true },
      );
    } catch (error) {
      ctx.ui.notify(`Image paste failed: ${getErrorMessage(error)}`, "warning");
    }
  };

  const pasteImageFromRecent = async (ctx: PasteContext): Promise<void> => {
    if (!ctx.hasUI) {
      ctx.ui.notify("/paste-image recent requires interactive TUI mode.", "warning");
      return;
    }

    try {
      const {
        discoverRecentImages,
        formatRecentImageLabel,
        getRecentImageCacheDirectory,
        loadRecentImage,
      } = await loadRecentImagesModule();
      const discovery = discoverRecentImages();
      if (discovery.candidates.length === 0) {
        ctx.ui.notify(
          buildRecentImageEmptyStateMessage(
            discovery.searchedDirectories,
            getRecentImageCacheDirectory(),
          ),
          "warning",
        );
        return;
      }

      const options = discovery.candidates.map((candidate, index) => {
        const rank = String(index + 1).padStart(2, "0");
        return `${rank}. ${formatRecentImageLabel(candidate)}`;
      });

      const selectedOption = await ctx.ui.select("Select a recent image", options);
      if (!selectedOption) {
        return;
      }

      const selectedIndex = options.indexOf(selectedOption);
      if (selectedIndex === -1) {
        ctx.ui.notify("Selected image no longer exists in the recent list. Please retry.", "warning");
        return;
      }

      const selectedCandidate = discovery.candidates[selectedIndex];
      const selectedImage = loadRecentImage(selectedCandidate);

      void showRecentSelectionPreview(pi, selectedImage, ctx.cwd, logger).catch((error: unknown) => {
        ctx.ui.notify(`Could not render recent image preview: ${getErrorMessage(error)}`, "warning");
      });

      queueImageAttachment(
        ctx,
        pendingImages,
        selectedImage,
        `Recent image attached: ${selectedCandidate.name}. Add your message, then send. A terminal preview will render after submit.`,
      );
    } catch (error) {
      ctx.ui.notify(`Recent image picker failed: ${getErrorMessage(error)}`, "warning");
    }
  };

  pi.on("input", async (event) => {
    if (event.source === "extension") {
      return { action: "continue" as const };
    }

    if (pendingImages.length === 0) {
      return { action: "continue" as const };
    }

    const markerCount = countOccurrences(event.text, IMAGE_ATTACHMENT_INDICATOR);
    if (markerCount === 0) {
      pendingImages.length = 0;
      return { action: "continue" as const };
    }

    const imagesToAttach = pendingImages.splice(0, markerCount);
    if (imagesToAttach.length === 0) {
      return { action: "continue" as const };
    }

    return {
      action: "transform" as const,
      text: removeAttachmentIndicators(event.text),
      images: [...(event.images ?? []), ...imagesToAttach],
    };
  });

  registerImagePasteKeybindings(pi, pasteImageFromClipboard, { config, logger });
  registerPasteImageCommand(pi, {
    fromClipboard: pasteImageFromClipboard,
    fromRecent: pasteImageFromRecent,
  });
}
