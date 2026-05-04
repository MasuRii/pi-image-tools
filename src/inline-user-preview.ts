import {
  type ExtensionAPI,
  InteractiveMode,
  UserMessageComponent,
} from "@mariozechner/pi-coding-agent";
import { Image, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

import { isRecord } from "./config.js";
import type { DebugLogger } from "./debug-logger.js";
import { getErrorMessage } from "./errors.js";
import { buildPreviewItems, type ImagePayload, type ImagePreviewItem } from "./image-preview.js";
import { buildSixelRenderLines, isInlineImageProtocolLine } from "./sixel-protocol.js";
import { setActiveTerminalImageSettingsCwd } from "./terminal-image-width.js";

type UserMessageRenderFn = (width: number) => string[];

type UserMessagePrototype = {
  render: UserMessageRenderFn;
  __piImageToolsInlineOriginalRender?: UserMessageRenderFn;
  __piImageToolsInlinePatched?: boolean;
};

type UserMessageInstance = {
  __piImageToolsInlineAssigned?: boolean;
  __piImageToolsInlineItems?: ImagePreviewItem[];
};

type InteractiveModePrototype = {
  addMessageToChat: (message: unknown, options?: unknown) => void;
  getUserMessageText: (message: unknown) => string;
  __piImageToolsOriginalAddMessageToChat?: (message: unknown, options?: unknown) => void;
  __piImageToolsOriginalGetUserMessageText?: (message: unknown) => string;
  __piImageToolsPreviewPatched?: boolean;
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
    children?: unknown[];
  };
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

function extractImagePayloads(message: unknown): ImagePayload[] {
  const userMessage = toUserMessage(message);
  if (userMessage.role !== "user") {
    return [];
  }

  if (!Array.isArray(userMessage.content)) {
    return [];
  }

  const payloads: ImagePayload[] = [];
  for (const part of userMessage.content) {
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

function imagePlaceholderText(count: number): string {
  if (count <= 1) {
    return "[󰈟 1 image attached]";
  }

  return `[󰈟 ${count} images attached]`;
}

function patchUserMessageRender(): void {
  const prototype = (UserMessageComponent as unknown as { prototype: UserMessagePrototype }).prototype;
  if (typeof prototype.render !== "function") {
    return;
  }

  if (!prototype.__piImageToolsInlineOriginalRender) {
    prototype.__piImageToolsInlineOriginalRender = prototype.render;
  }

  if (prototype.__piImageToolsInlinePatched) {
    return;
  }

  prototype.render = function renderWithInlineImagePreview(width: number): string[] {
    const originalRender = prototype.__piImageToolsInlineOriginalRender;
    if (!originalRender) {
      return [];
    }

    const instance = this as unknown as UserMessageInstance;
    if (!instance.__piImageToolsInlineAssigned) {
      instance.__piImageToolsInlineAssigned = true;
      if (!Array.isArray(instance.__piImageToolsInlineItems)) {
        instance.__piImageToolsInlineItems = [];
      }
    }

    const baseLines = originalRender.call(this, width);
    const previewLines = renderPreviewLines(instance.__piImageToolsInlineItems ?? [], width);
    if (previewLines.length === 0) {
      return baseLines;
    }

    return [...baseLines, ...previewLines];
  };

  prototype.__piImageToolsInlinePatched = true;
}

function assignPreviewItemsToLatestUserMessage(
  mode: InteractiveModeLike,
  fromChildIndex: number,
  previewItems: ImagePreviewItem[],
): void {
  const children = mode.chatContainer?.children;
  if (!Array.isArray(children) || children.length === 0) {
    return;
  }

  const start = Math.max(0, fromChildIndex);
  for (let index = children.length - 1; index >= start; index -= 1) {
    const child = children[index];
    if (!(child instanceof UserMessageComponent)) {
      continue;
    }

    const instance = child as unknown as UserMessageInstance;
    instance.__piImageToolsInlineItems = previewItems;
    instance.__piImageToolsInlineAssigned = true;
    return;
  }
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

  if (prototype.__piImageToolsPreviewPatched) {
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
    let previewItems: ImagePreviewItem[] = [];
    if (imagePayloads.length > 0) {
      try {
        previewItems = buildPreviewItems(imagePayloads);
      } catch (error) {
        logInlinePreviewError(logger, "inline-user-preview.build_preview_failed", error);
        previewItems = [];
      }
    }

    const original = prototype.__piImageToolsOriginalAddMessageToChat;
    if (!original) {
      return;
    }

    original.call(this, message, options);

    if (previewItems.length === 0) {
      return;
    }

    assignPreviewItemsToLatestUserMessage(mode, beforeCount, previewItems);
  };

  prototype.__piImageToolsPreviewPatched = true;
}

export interface RegisterInlineUserImagePreviewOptions {
  logger?: DebugLogger;
}

export function registerInlineUserImagePreview(
  pi: ExtensionAPI,
  options: RegisterInlineUserImagePreviewOptions = {},
): void {
  const runPatch = (delayMs: number): void => {
    setTimeout(() => {
      try {
        patchInteractiveMode(options.logger);
        patchUserMessageRender();
      } catch (error) {
        logInlinePreviewError(options.logger, "inline-user-preview.patch_failed", error);
      }
    }, delayMs);
  };

  const schedulePatch = (): void => {
    runPatch(0);
    runPatch(25);
  };

  const handleSessionEvent = (eventName: string, cwd: string | undefined): void => {
    try {
      setActiveTerminalImageSettingsCwd(cwd);
      schedulePatch();
    } catch (error) {
      logInlinePreviewError(options.logger, `inline-user-preview.${eventName}_failed`, error);
    }
  };

  pi.on("session_start", async (_event, ctx) => {
    handleSessionEvent("session_start", ctx.cwd);
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    handleSessionEvent("before_agent_start", ctx.cwd);
  });

  const onSessionSwitch = pi.on as unknown as (
    event: "session_switch",
    handler: (_event: unknown, ctx: { cwd?: string }) => Promise<void>,
  ) => void;

  onSessionSwitch("session_switch", async (_event, ctx) => {
    handleSessionEvent("session_switch", ctx.cwd);
  });
}
