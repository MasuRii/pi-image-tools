import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { getAgentDir, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { TUI_KEYBINDINGS, type KeyId, type KeybindingsConfig } from "@mariozechner/pi-tui";

import { isRecord, type ImageToolsConfig } from "./config.js";
import type { DebugLogger } from "./debug-logger.js";
import type { PasteImageHandler } from "./types.js";

type KeybindingDefaults = Record<string, KeyId | KeyId[]>;

const LEGACY_KEYBINDING_NAME_MIGRATIONS: Record<string, string> = {
  cursorUp: "tui.editor.cursorUp",
  cursorDown: "tui.editor.cursorDown",
  cursorLeft: "tui.editor.cursorLeft",
  cursorRight: "tui.editor.cursorRight",
  cursorWordLeft: "tui.editor.cursorWordLeft",
  cursorWordRight: "tui.editor.cursorWordRight",
  cursorLineStart: "tui.editor.cursorLineStart",
  cursorLineEnd: "tui.editor.cursorLineEnd",
  jumpForward: "tui.editor.jumpForward",
  jumpBackward: "tui.editor.jumpBackward",
  pageUp: "tui.editor.pageUp",
  pageDown: "tui.editor.pageDown",
  deleteCharBackward: "tui.editor.deleteCharBackward",
  deleteCharForward: "tui.editor.deleteCharForward",
  deleteWordBackward: "tui.editor.deleteWordBackward",
  deleteWordForward: "tui.editor.deleteWordForward",
  deleteToLineStart: "tui.editor.deleteToLineStart",
  deleteToLineEnd: "tui.editor.deleteToLineEnd",
  yank: "tui.editor.yank",
  yankPop: "tui.editor.yankPop",
  undo: "tui.editor.undo",
  newLine: "tui.input.newLine",
  submit: "tui.input.submit",
  tab: "tui.input.tab",
  copy: "tui.input.copy",
  selectUp: "tui.select.up",
  selectDown: "tui.select.down",
  selectPageUp: "tui.select.pageUp",
  selectPageDown: "tui.select.pageDown",
  selectConfirm: "tui.select.confirm",
  selectCancel: "tui.select.cancel",
  interrupt: "app.interrupt",
  clear: "app.clear",
  exit: "app.exit",
  suspend: "app.suspend",
  cycleThinkingLevel: "app.thinking.cycle",
  cycleModelForward: "app.model.cycleForward",
  cycleModelBackward: "app.model.cycleBackward",
  selectModel: "app.model.select",
  expandTools: "app.tools.expand",
  toggleThinking: "app.thinking.toggle",
  toggleSessionNamedFilter: "app.session.toggleNamedFilter",
  externalEditor: "app.editor.external",
  followUp: "app.message.followUp",
  dequeue: "app.message.dequeue",
  pasteImage: "app.clipboard.pasteImage",
  newSession: "app.session.new",
  tree: "app.session.tree",
  fork: "app.session.fork",
  resume: "app.session.resume",
  treeFoldOrUp: "app.tree.foldOrUp",
  treeUnfoldOrDown: "app.tree.unfoldOrDown",
  treeEditLabel: "app.tree.editLabel",
  treeToggleLabelTimestamp: "app.tree.toggleLabelTimestamp",
  toggleSessionPath: "app.session.togglePath",
  toggleSessionSort: "app.session.toggleSort",
  renameSession: "app.session.rename",
  deleteSession: "app.session.delete",
  deleteSessionNoninvasive: "app.session.deleteNoninvasive",
};

const APP_KEYBINDING_DEFAULTS: KeybindingDefaults = {
  "app.interrupt": "escape",
  "app.clear": "ctrl+c",
  "app.exit": "ctrl+d",
  "app.suspend": process.platform === "win32" ? [] : "ctrl+z",
  "app.thinking.cycle": "shift+tab",
  "app.model.cycleForward": "ctrl+p",
  "app.model.cycleBackward": "shift+ctrl+p",
  "app.model.select": "ctrl+l",
  "app.tools.expand": "ctrl+o",
  "app.thinking.toggle": "ctrl+t",
  "app.session.toggleNamedFilter": "ctrl+n",
  "app.editor.external": "ctrl+g",
  "app.message.followUp": "alt+enter",
  "app.message.dequeue": "alt+up",
  "app.clipboard.pasteImage": process.platform === "win32" ? "alt+v" : "ctrl+v",
  "app.session.new": [],
  "app.session.tree": [],
  "app.session.fork": [],
  "app.session.resume": [],
  "app.tree.foldOrUp": ["ctrl+left", "alt+left"],
  "app.tree.unfoldOrDown": ["ctrl+right", "alt+right"],
  "app.tree.editLabel": "shift+l",
  "app.tree.toggleLabelTimestamp": "shift+t",
  "app.session.togglePath": "ctrl+p",
  "app.session.toggleSort": "ctrl+s",
  "app.session.rename": "ctrl+r",
  "app.session.delete": "ctrl+d",
  "app.session.deleteNoninvasive": "ctrl+backspace",
  "app.models.save": "ctrl+s",
  "app.models.enableAll": "ctrl+a",
  "app.models.clearAll": "ctrl+x",
  "app.models.toggleProvider": "ctrl+p",
  "app.models.reorderUp": "alt+up",
  "app.models.reorderDown": "alt+down",
  "app.tree.filter.default": "ctrl+d",
  "app.tree.filter.noTools": "ctrl+t",
  "app.tree.filter.userOnly": "ctrl+u",
  "app.tree.filter.labeledOnly": "ctrl+l",
  "app.tree.filter.all": "ctrl+a",
  "app.tree.filter.cycleForward": "ctrl+o",
  "app.tree.filter.cycleBackward": "shift+ctrl+o",
};

export interface RegisterImagePasteKeybindingsOptions {
  config: ImageToolsConfig;
  logger: DebugLogger;
}

function toShortcutList(shortcuts: KeybindingsConfig[string]): KeyId[] {
  if (shortcuts === undefined) {
    return [];
  }

  return Array.isArray(shortcuts) ? shortcuts : [shortcuts];
}

function normalizeKeybinding(value: unknown): KeybindingsConfig[string] | undefined {
  if (typeof value === "string") {
    return value as KeyId;
  }

  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
    return value as KeyId[];
  }

  return undefined;
}

function normalizeShortcutKey(shortcut: KeyId): string {
  return shortcut.toLowerCase();
}

function readKeybindingsConfig(): Record<string, unknown> | undefined {
  const keybindingsPath = join(getAgentDir(), "keybindings.json");
  if (!existsSync(keybindingsPath)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(readFileSync(keybindingsPath, "utf-8")) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function migrateKeybindingName(key: string): string {
  return LEGACY_KEYBINDING_NAME_MIGRATIONS[key] ?? key;
}

function normalizeUserKeybindings(rawConfig: Record<string, unknown> | undefined): KeybindingsConfig {
  if (!rawConfig) {
    return {};
  }

  const userKeybindings: KeybindingsConfig = {};
  for (const [key, value] of Object.entries(rawConfig)) {
    const normalizedValue = normalizeKeybinding(value);
    if (normalizedValue === undefined) {
      continue;
    }

    const migratedKey = migrateKeybindingName(key);
    if (migratedKey !== key && Object.hasOwn(rawConfig, migratedKey)) {
      continue;
    }

    userKeybindings[migratedKey] = normalizedValue;
  }

  return userKeybindings;
}

function getBuiltinKeybindingDefaults(): KeybindingDefaults {
  const tuiDefaults: KeybindingDefaults = {};
  for (const [keybinding, definition] of Object.entries(TUI_KEYBINDINGS)) {
    tuiDefaults[keybinding] = definition.defaultKeys;
  }

  return {
    ...tuiDefaults,
    ...APP_KEYBINDING_DEFAULTS,
  };
}

function getConfiguredBuiltinShortcuts(): Set<string> {
  const defaults = getBuiltinKeybindingDefaults();
  const userKeybindings = normalizeUserKeybindings(readKeybindingsConfig());
  const builtinShortcuts = new Set<string>();

  for (const [keybinding, defaultShortcuts] of Object.entries(defaults)) {
    const configuredShortcuts = Object.hasOwn(userKeybindings, keybinding)
      ? userKeybindings[keybinding]
      : defaultShortcuts;

    for (const shortcut of toShortcutList(configuredShortcuts)) {
      builtinShortcuts.add(normalizeShortcutKey(shortcut));
    }
  }

  return builtinShortcuts;
}

function getImagePasteShortcutCandidates(platform: NodeJS.Platform): KeyId[] {
  if (platform === "win32") {
    return ["alt+v", "ctrl+alt+v"];
  }

  return ["ctrl+v", "alt+v", "ctrl+alt+v"];
}

function removeBuiltinConflicts(shortcuts: readonly KeyId[]): KeyId[] {
  const builtinShortcuts = getConfiguredBuiltinShortcuts();

  return shortcuts.filter((shortcut) => !builtinShortcuts.has(normalizeShortcutKey(shortcut)));
}

function getImagePasteShortcuts(
  config: ImageToolsConfig,
  platform: NodeJS.Platform = process.platform,
): KeyId[] {
  const shouldAvoidBuiltinConflicts =
    config.shortcuts.avoidBuiltinConflicts || config.shortcuts.suppressBuiltinConflictWarnings;

  if (config.shortcuts.pasteImage !== undefined) {
    return shouldAvoidBuiltinConflicts
      ? removeBuiltinConflicts(config.shortcuts.pasteImage)
      : config.shortcuts.pasteImage;
  }

  return removeBuiltinConflicts(getImagePasteShortcutCandidates(platform));
}

export function registerImagePasteKeybindings(
  pi: ExtensionAPI,
  handler: PasteImageHandler,
  options: RegisterImagePasteKeybindingsOptions,
): void {
  const configuredShortcuts = options.config.shortcuts.pasteImage;
  const shortcuts = getImagePasteShortcuts(options.config);
  const skippedShortcuts = configuredShortcuts?.filter(
    (shortcut) => !shortcuts.some((registeredShortcut) => normalizeShortcutKey(registeredShortcut) === normalizeShortcutKey(shortcut)),
  ) ?? [];

  options.logger.log("keybindings.register", {
    avoidBuiltinConflicts: options.config.shortcuts.avoidBuiltinConflicts,
    suppressBuiltinConflictWarnings: options.config.shortcuts.suppressBuiltinConflictWarnings,
    configured: configuredShortcuts !== undefined,
    registeredShortcuts: shortcuts,
    skippedShortcuts,
  });

  for (const shortcut of shortcuts) {
    pi.registerShortcut(shortcut, {
      description: "Attach clipboard image to draft (send when ready)",
      handler,
    });
  }
}
