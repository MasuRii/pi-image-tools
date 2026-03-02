import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { readClipboardImage } from "./clipboard.js";
import { registerPasteImageCommand } from "./commands.js";
import {
  IMAGE_PREVIEW_CUSTOM_TYPE,
  buildPreviewItems,
  registerImagePreviewDisplay,
  type ImagePayload,
} from "./image-preview.js";
import { registerInlineUserImagePreview } from "./inline-user-preview.js";
import { registerImagePasteKeybindings } from "./keybindings.js";
import {
  RECENT_IMAGE_CACHE_DIR_ENV_VAR,
  RECENT_IMAGE_ENV_VAR,
  discoverRecentImages,
  formatRecentImageLabel,
  getRecentImageCacheDirectory,
  loadRecentImage,
  persistImageToRecentCache,
} from "./recent-images.js";
import type { ClipboardImage, PasteContext } from "./types.js";

const IMAGE_ATTACHMENT_INDICATOR = "[󰈟 Image Attached]";

interface PendingImage extends ImagePayload {}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Unknown error";
}

function isWindowsPlatform(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "win32";
}

function imageToBase64(image: ClipboardImage): string {
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
    try {
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

  if (!ctx.hasUI) {
    return;
  }

  ctx.ui.pasteToEditor(`${IMAGE_ATTACHMENT_INDICATOR} `);
  ctx.ui.notify(successMessage, "info");
}

function buildRecentImageEmptyStateMessage(searchedDirectories: readonly string[]): string {
  const searched =
    searchedDirectories.length > 0
      ? searchedDirectories.join("; ")
      : "No directories configured";
  const cacheDirectory = getRecentImageCacheDirectory();

  return [
    `No recent images found. Searched: ${searched}`,
    `Clipboard-pasted images are cached in: ${cacheDirectory}`,
    `Set ${RECENT_IMAGE_ENV_VAR} to a semicolon-separated list of directories to override defaults.`,
    `Set ${RECENT_IMAGE_CACHE_DIR_ENV_VAR} to customize the cache directory.`,
  ].join(" ");
}

function showRecentSelectionPreview(
  pi: ExtensionAPI,
  image: ClipboardImage,
): void {
  const previewItems = buildPreviewItems([
    {
      type: "image",
      data: imageToBase64(image),
      mimeType: image.mimeType,
    },
  ]);

  if (previewItems.length === 0) {
    return;
  }

  pi.sendMessage(
    {
      customType: IMAGE_PREVIEW_CUSTOM_TYPE,
      content: "",
      display: true,
      details: { items: previewItems },
    },
    { triggerTurn: false },
  );
}

export default function imageToolsExtension(pi: ExtensionAPI): void {
  if (!isWindowsPlatform()) {
    return;
  }

  const pendingImages: PendingImage[] = [];

  registerInlineUserImagePreview(pi);
  registerImagePreviewDisplay(pi);

  const pasteImageFromClipboard = async (ctx: PasteContext): Promise<void> => {
    if (!ctx.hasUI) {
      return;
    }

    try {
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
      const discovery = discoverRecentImages();
      if (discovery.candidates.length === 0) {
        ctx.ui.notify(buildRecentImageEmptyStateMessage(discovery.searchedDirectories), "warning");
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

      try {
        showRecentSelectionPreview(pi, selectedImage);
      } catch (error) {
        ctx.ui.notify(`Could not render recent image preview: ${getErrorMessage(error)}`, "warning");
      }

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

  registerImagePasteKeybindings(pi, pasteImageFromClipboard);
  registerPasteImageCommand(pi, {
    fromClipboard: pasteImageFromClipboard,
    fromRecent: pasteImageFromRecent,
  });
}
