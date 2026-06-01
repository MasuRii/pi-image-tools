import {
  type ExtensionAPI,
  InteractiveMode,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { Image, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { isRecord } from "./config.js";
import type { DebugLogger } from "./debug-logger.js";
import { getErrorMessage } from "./errors.js";
import { buildPreviewItems, type ImagePayload, type ImagePreviewItem } from "./image-preview.js";
import { buildSixelRenderLines, isInlineImageProtocolLine } from "./sixel-protocol.js";
import { setActiveTerminalImageSettingsCwd } from "./terminal-image-width.js";

const INLINE_PREVIEW_PATCH_VERSION = "pi-image-tools-inline-preview-chat-component-v4";
const PREPARE_SUBMITTED_PREVIEW_TIMEOUT_MS = 2_500;

type UserMessageInstance = {
  render?: (width: number) => string[];
};

type InteractiveModePrototype = {
  addMessageToChat: (message: unknown, options?: unknown) => void;
  getUserMessageText: (message: unknown) => string;
  __piImageToolsOriginalAddMessageToChat?: (message: unknown, options?: unknown) => void;
  __piImageToolsOriginalGetUserMessageText?: (message: unknown) => string;
  __piImageToolsPreviewPatched?: boolean;
  __piImageToolsPreviewPatchVersion?: string;
};

interface UserImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

interface UserMessageLike {
  role?: unknown;
  content?: unknown;
}

interface InteractiveModeLike {
  chatContainer?: {
    addChild?: (component: unknown) => void;
    children?: unknown[];
  };
  ui?: {
    requestRender?: () => void;
  };
}

class ImagePreviewChatComponent {
  constructor(private readonly items: readonly ImagePreviewItem[]) {}

  invalidate(): void {}

  render(width: number): string[] {
    return renderPreviewLines(this.items, width);
  }
}

function buildNativeLines(item: ImagePreviewItem, width: number): string[] {
  if (!item.data) {
    return [];
  }

  const image = new Image(
    item.data,
    item.mimeType,
    {
      fallbackColor: (text: string) => text,
    },
    {
      maxWidthCells: item.maxWidthCells,
    },
  );

  return image.render(Math.max(8, width));
}

function fitLineToWidth(line: string, width: number): string {
  const safeWidth = Math.max(1, Math.floor(width));
  if (isInlineImageProtocolLine(line)) {
    return line;
  }

  if (visibleWidth(line) <= safeWidth) {
    return line;
  }

  return truncateToWidth(line, safeWidth, "", true);
}

function fitLinesToWidth(lines: readonly string[], width: number): string[] {
  return lines.map((line) => fitLineToWidth(line, width));
}

function renderPreviewLines(items: readonly ImagePreviewItem[], width: number): string[] {
  if (items.length === 0) {
    return [];
  }

  const lines: string[] = ["", "↳ pasted image preview"];

  for (const item of items) {
    lines.push("");

    if (item.protocol === "sixel" && item.sixelSequence) {
      lines.push(...buildSixelRenderLines(item.sixelSequence, item.rows));
    } else {
      lines.push(...buildNativeLines(item, width));
    }

    if (item.warning) {
      lines.push(...item.warning.split(/\r?\n/).filter((line) => line.length > 0));
    }
  }

  return fitLinesToWidth(lines, width);
}

function toUserMessage(value: unknown): UserMessageLike {
  return isRecord(value) ? value : {};
}

function toImageContent(value: unknown): UserImageContent | null {
  if (!isRecord(value)) {
    return null;
  }

  const record = value;
  if (record.type !== "image") {
    return null;
  }

  if (typeof record.data !== "string" || record.data.length === 0) {
    return null;
  }

  return {
    type: "image",
    data: record.data,
    mimeType: typeof record.mimeType === "string" && record.mimeType.length > 0
      ? record.mimeType
      : "image/png",
  };
}

function extractImagePayloadsFromContent(content: unknown): ImagePayload[] {
  if (!Array.isArray(content)) {
    return [];
  }

  const payloads: ImagePayload[] = [];
  for (const part of content) {
    const image = toImageContent(part);
    if (!image) {
      continue;
    }

    payloads.push({
      type: "image",
      data: image.data,
      mimeType: image.mimeType,
    });
  }

  return payloads;
}

function extractImagePayloads(message: unknown): ImagePayload[] {
  const userMessage = toUserMessage(message);
  if (userMessage.role !== "user") {
    return [];
  }

  return extractImagePayloadsFromContent(userMessage.content);
}

function getImagePayloadSignature(images: readonly ImagePayload[]): string {
  return images
    .map((image) => `${image.mimeType}:${image.data.length}:${image.data.slice(0, 32)}:${image.data.slice(-32)}`)
    .join("|");
}

interface PreparedPreviewItems {
  signature: string;
  items: ImagePreviewItem[];
}

const preparedPreviewItemsQueue: PreparedPreviewItems[] = [];
const inFlightPreviewItems = new Map<string, Promise<ImagePreviewItem[]>>();

function queuePreparedPreviewItems(images: readonly ImagePayload[], items: ImagePreviewItem[]): void {
  if (images.length === 0 || items.length === 0) {
    return;
  }

  preparedPreviewItemsQueue.push({
    signature: getImagePayloadSignature(images),
    items,
  });

  if (preparedPreviewItemsQueue.length > 8) {
    preparedPreviewItemsQueue.splice(0, preparedPreviewItemsQueue.length - 8);
  }
}

function consumePreparedPreviewItems(images: readonly ImagePayload[]): ImagePreviewItem[] | undefined {
  if (images.length === 0 || preparedPreviewItemsQueue.length === 0) {
    return undefined;
  }

  const signature = getImagePayloadSignature(images);
  const index = preparedPreviewItemsQueue.findIndex((entry) => entry.signature === signature);
  if (index === -1) {
    return undefined;
  }

  const [entry] = preparedPreviewItemsQueue.splice(index, 1);
  return entry?.items;
}

function getInFlightPreviewItems(images: readonly ImagePayload[]): Promise<ImagePreviewItem[]> | undefined {
  if (images.length === 0) {
    return undefined;
  }

  return inFlightPreviewItems.get(getImagePayloadSignature(images));
}

function buildPreviewItemsOnce(
  images: readonly ImagePayload[],
  options: { cwd?: string; logger?: DebugLogger } = {},
): Promise<ImagePreviewItem[]> {
  const signature = getImagePayloadSignature(images);
  const existing = inFlightPreviewItems.get(signature);
  if (existing) {
    return existing;
  }

  const promise = buildPreviewItems(images, options);
  promise.then(
    () => inFlightPreviewItems.delete(signature),
    () => inFlightPreviewItems.delete(signature),
  );
  promise.catch(() => {
    // Consumers log contextual errors; this prevents unhandled rejections when prebuild times out.
  });
  inFlightPreviewItems.set(signature, promise);
  return promise;
}

async function waitForPreviewItemsDeadline(
  previewItemsPromise: Promise<ImagePreviewItem[]>,
): Promise<ImagePreviewItem[] | undefined> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      previewItemsPromise,
      new Promise<undefined>((resolve) => {
        timeout = setTimeout(() => resolve(undefined), PREPARE_SUBMITTED_PREVIEW_TIMEOUT_MS);
        timeout.unref?.();
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function imagePlaceholderText(count: number): string {
  if (count <= 1) {
    return "[󰈟 1 image attached]";
  }

  return `[󰈟 ${count} images attached]`;
}

function isUserMessageComponentLike(value: unknown): value is UserMessageInstance {
  if (value instanceof UserMessageComponent) {
    return true;
  }

  if (!isRecord(value) || typeof value.render !== "function") {
    return false;
  }

  const constructorName =
    typeof value.constructor === "function" && typeof value.constructor.name === "string"
      ? value.constructor.name
      : undefined;

  return constructorName === "UserMessageComponent";
}

function requestInteractiveModeRender(mode: InteractiveModeLike): void {
  try {
    mode.ui?.requestRender?.();
  } catch {
    // Rendering will be retried by the next TUI update.
  }
}

function addPreviewItemsAfterLatestUserMessage(
  mode: InteractiveModeLike,
  fromChildIndex: number,
  previewItems: ImagePreviewItem[],
): boolean {
  const chatContainer = mode.chatContainer;
  const children = chatContainer?.children;
  if (!Array.isArray(children) || children.length === 0 || previewItems.length === 0) {
    return false;
  }

  const start = Math.max(0, fromChildIndex);
  for (let index = children.length - 1; index >= start; index -= 1) {
    const child = children[index];
    if (!isUserMessageComponentLike(child)) {
      continue;
    }

    const previewComponent = new ImagePreviewChatComponent(previewItems);
    const insertIndex = index + 1;
    if (insertIndex >= children.length && typeof chatContainer?.addChild === "function") {
      chatContainer.addChild(previewComponent);
    } else {
      children.splice(insertIndex, 0, previewComponent);
    }
    return true;
  }

  return false;
}

function logInlinePreviewError(
  logger: DebugLogger | undefined,
  event: string,
  error: unknown,
): void {
  try {
    logger?.log(event, { error: getErrorMessage(error) });
  } catch {
    // Debug logging is best-effort inside Pi event handlers.
  }
}

function patchInteractiveMode(logger?: DebugLogger): void {
  const prototype = (InteractiveMode as unknown as { prototype: InteractiveModePrototype }).prototype;
  if (!prototype) {
    return;
  }

  if (!prototype.__piImageToolsOriginalGetUserMessageText) {
    prototype.__piImageToolsOriginalGetUserMessageText = prototype.getUserMessageText;
  }

  if (!prototype.__piImageToolsOriginalAddMessageToChat) {
    prototype.__piImageToolsOriginalAddMessageToChat = prototype.addMessageToChat;
  }

  if (
    prototype.__piImageToolsPreviewPatched &&
    prototype.__piImageToolsPreviewPatchVersion === INLINE_PREVIEW_PATCH_VERSION
  ) {
    return;
  }

  prototype.getUserMessageText = function getUserMessageTextWithImagePlaceholder(message: unknown): string {
    const original = prototype.__piImageToolsOriginalGetUserMessageText;
    const text = original ? original.call(this, message) : "";
    if (text.trim().length > 0) {
      return text;
    }

    const images = extractImagePayloads(message);
    if (images.length === 0) {
      return text;
    }

    return imagePlaceholderText(images.length);
  };

  prototype.addMessageToChat = function addMessageToChatWithImagePreview(message: unknown, options?: unknown): void {
    const mode = this as unknown as InteractiveModeLike;
    const beforeCount = Array.isArray(mode.chatContainer?.children)
      ? mode.chatContainer?.children.length ?? 0
      : 0;

    const imagePayloads = extractImagePayloads(message);
    const original = prototype.__piImageToolsOriginalAddMessageToChat;
    if (!original) {
      return;
    }

    original.call(this, message, options);

    if (imagePayloads.length === 0) {
      return;
    }

    const preparedPreviewItems = consumePreparedPreviewItems(imagePayloads);
    if (preparedPreviewItems) {
      if (addPreviewItemsAfterLatestUserMessage(mode, beforeCount, preparedPreviewItems)) {
        requestInteractiveModeRender(mode);
      }
      return;
    }

    const previewItemsPromise = getInFlightPreviewItems(imagePayloads)
      ?? buildPreviewItemsOnce(imagePayloads, { logger });

    void previewItemsPromise
      .then((previewItems) => {
        if (previewItems.length === 0) {
          return;
        }

        if (addPreviewItemsAfterLatestUserMessage(mode, beforeCount, previewItems)) {
          requestInteractiveModeRender(mode);
        }
      })
      .catch((error: unknown) => {
        logInlinePreviewError(logger, "inline-user-preview.build_preview_failed", error);
      });
  };

  prototype.__piImageToolsPreviewPatched = true;
  prototype.__piImageToolsPreviewPatchVersion = INLINE_PREVIEW_PATCH_VERSION;
}

export interface RegisterInlineUserImagePreviewOptions {
  logger?: DebugLogger;
}

export function registerInlineUserImagePreview(
  pi: ExtensionAPI,
  options: RegisterInlineUserImagePreviewOptions = {},
): void {
  const applyPatch = (): void => {
    try {
      patchInteractiveMode(options.logger);
    } catch (error) {
      logInlinePreviewError(options.logger, "inline-user-preview.patch_failed", error);
    }
  };

  const runPatch = (delayMs: number): void => {
    setTimeout(applyPatch, delayMs);
  };

  const schedulePatch = (): void => {
    runPatch(0);
    runPatch(25);
  };

  const handleSessionEvent = (eventName: string, cwd: string | undefined): void => {
    try {
      setActiveTerminalImageSettingsCwd(cwd);
      applyPatch();
      schedulePatch();
    } catch (error) {
      logInlinePreviewError(options.logger, `inline-user-preview.${eventName}_failed`, error);
    }
  };

  const prepareSubmittedImagePreview = async (
    event: { images?: unknown },
    cwd: string | undefined,
  ): Promise<{ imagePayloads: ImagePayload[]; previewItems: ImagePreviewItem[] } | undefined> => {
    try {
      setActiveTerminalImageSettingsCwd(cwd);
      applyPatch();
      const imagePayloads = extractImagePayloadsFromContent(event.images);
      if (imagePayloads.length === 0) {
        return undefined;
      }

      const previewItemsPromise = buildPreviewItemsOnce(imagePayloads, { cwd, logger: options.logger });
      const previewItems = await waitForPreviewItemsDeadline(previewItemsPromise);
      if (!previewItems || previewItems.length === 0) {
        return undefined;
      }

      return { imagePayloads, previewItems };
    } catch (error) {
      logInlinePreviewError(options.logger, "inline-user-preview.prepare_submitted_preview_failed", error);
      return undefined;
    }
  };

  applyPatch();

  pi.on("session_start", async (_event, ctx) => {
    handleSessionEvent("session_start", ctx.cwd);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    handleSessionEvent("before_agent_start", ctx.cwd);
    if (!ctx.hasUI) {
      return undefined;
    }

    const preparedPreview = await prepareSubmittedImagePreview(event, ctx.cwd);
    if (!preparedPreview) {
      return undefined;
    }

    queuePreparedPreviewItems(preparedPreview.imagePayloads, preparedPreview.previewItems);
    return undefined;
  });

  const onSessionSwitch = pi.on as unknown as (
    event: "session_switch",
    handler: (_event: unknown, ctx: { cwd?: string }) => Promise<void>,
  ) => void;

  onSessionSwitch("session_switch", async (_event, ctx) => {
    handleSessionEvent("session_switch", ctx.cwd);
  });
}
