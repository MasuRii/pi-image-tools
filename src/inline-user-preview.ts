import {
  type ExtensionAPI,
  InteractiveMode,
  UserMessageComponent,
} from "@mariozechner/pi-coding-agent";
import { Image, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

import { buildPreviewItems, type ImagePayload, type ImagePreviewItem } from "./image-preview.js";

const SIXEL_IMAGE_LINE_MARKER = "\x1b_Gm=0;\x1b\\";
const KITTY_IMAGE_LINE_MARKER = "\x1b_G";
const ITERM_IMAGE_LINE_MARKER = "\x1b]1337;File=";

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

function sanitizeRows(rows: number): number {
  return Math.max(1, Math.min(Math.trunc(rows), 80));
}

function buildSixelLines(sequence: string, rows: number): string[] {
  const safeRows = sanitizeRows(rows);
  const lines = Array.from({ length: Math.max(0, safeRows - 1) }, () => "");
  const moveUp = safeRows > 1 ? `\x1b[${safeRows - 1}A` : "";
  return [...lines, `${SIXEL_IMAGE_LINE_MARKER}${moveUp}${sequence}`];
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

function isInlineImageLine(line: string): boolean {
  return (
    line.startsWith(SIXEL_IMAGE_LINE_MARKER) ||
    line.includes(SIXEL_IMAGE_LINE_MARKER) ||
    line.startsWith(KITTY_IMAGE_LINE_MARKER) ||
    line.includes(KITTY_IMAGE_LINE_MARKER) ||
    line.startsWith(ITERM_IMAGE_LINE_MARKER) ||
    line.includes(ITERM_IMAGE_LINE_MARKER)
  );
}

function fitLineToWidth(line: string, width: number): string {
  const safeWidth = Math.max(1, Math.floor(width));
  if (isInlineImageLine(line)) {
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
      lines.push(...buildSixelLines(item.sixelSequence, item.rows));
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
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as UserMessageLike;
}

function toImageContent(value: unknown): UserImageContent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
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

function patchInteractiveMode(): void {
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
      } catch {
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

export function registerInlineUserImagePreview(pi: ExtensionAPI): void {
  const schedulePatch = (): void => {
    setTimeout(() => {
      patchInteractiveMode();
      patchUserMessageRender();
    }, 0);

    setTimeout(() => {
      patchInteractiveMode();
      patchUserMessageRender();
    }, 25);
  };

  pi.on("session_start", async () => {
    schedulePatch();
  });

  pi.on("before_agent_start", async () => {
    schedulePatch();
  });

  pi.on("session_switch", async () => {
    schedulePatch();
  });
}
