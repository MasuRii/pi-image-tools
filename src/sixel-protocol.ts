const SIXEL_IMAGE_LINE_MARKER = "\x1b_Gm=0;\x1b\\";
const KITTY_IMAGE_LINE_MARKER = "\x1b_G";
const ITERM_IMAGE_LINE_MARKER = "\x1b]1337;File=";
const SIXEL_DCS_PREFIX = "\x1bP";
const STRING_TERMINATOR = "\x1b\\";
const MAX_IMAGE_ROWS = 80;

function sanitizeRows(rows: number): number {
  return Math.max(1, Math.min(Math.trunc(rows), MAX_IMAGE_ROWS));
}

function normalizeSixelOutput(value: string): string {
  return value.replace(/\r?\n/g, "").replace(/\s+$/g, "");
}

/**
 * Ensure the PowerShell Sixel output is emitted as a complete DCS sequence.
 * Some converters return only the sixel payload body; terminals need the
 * enclosing ESC P ... ESC \\ wrapper to render it as an image.
 */
export function ensureCompleteSixelSequence(sequence: string): string {
  let normalized = normalizeSixelOutput(sequence);
  if (normalized.length === 0) {
    return "";
  }

  if (!normalized.startsWith(SIXEL_DCS_PREFIX)) {
    normalized = `${SIXEL_DCS_PREFIX}${normalized.startsWith("q") ? normalized : `q${normalized}`}`;
  }

  if (!normalized.endsWith(STRING_TERMINATOR)) {
    normalized = `${normalized}${STRING_TERMINATOR}`;
  }

  return normalized;
}

export function buildSixelRenderLines(sequence: string, rows: number): string[] {
  const safeRows = sanitizeRows(rows);
  const completeSequence = ensureCompleteSixelSequence(sequence);
  if (completeSequence.length === 0) {
    return [];
  }

  const lines = Array.from({ length: Math.max(0, safeRows - 1) }, () => "");
  const moveUp = safeRows > 1 ? `\x1b[${safeRows - 1}A` : "";
  return [...lines, `${SIXEL_IMAGE_LINE_MARKER}${moveUp}${completeSequence}`];
}

export function isInlineImageProtocolLine(line: string): boolean {
  return (
    line.includes(SIXEL_IMAGE_LINE_MARKER) ||
    line.includes(KITTY_IMAGE_LINE_MARKER) ||
    line.includes(ITERM_IMAGE_LINE_MARKER) ||
    line.includes(SIXEL_DCS_PREFIX)
  );
}
