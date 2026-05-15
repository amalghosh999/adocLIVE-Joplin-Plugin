/**
 * Audio macro serialization and parsing.
 *
 * Per https://docs.asciidoctor.org/asciidoc/latest/macros/audio-and-video/, the
 * AsciiDoc audio macro form is:
 *   `audio::TARGET[<named-attrs>]`
 * with attributes limited to `start`, `end`, and `opts="autoplay,loop,nocontrols"`.
 * Block title (caption) is the line `.Caption text` immediately above the macro.
 */

export interface AudioOptionFlags {
  autoplay: boolean;
  loop: boolean;
  /** Disable controls. (`controls` is the default and need not be emitted.) */
  nocontrols: boolean;
}

export interface AudioOptions {
  /** A local path or a direct URL. */
  target: string;
  /** Block title (`.Caption` line above the macro). */
  caption: string;
  /** Start offset in seconds (0 = omit). */
  start: number;
  /** End offset in seconds (0 = omit). */
  end: number;
  options: AudioOptionFlags;
}

export interface ParsedAudioMacro extends AudioOptions {
  isRemote: boolean;
}

function escapeAttr(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function splitAttrs(attrText: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of attrText) {
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === "," && !inQuotes) {
      if (current.trim()) out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function stripWrappedQuotes(value: string): string {
  return value.replace(/^"(.*)"$/, "$1").trim();
}

function parseIntFlexible(value: string | undefined): number {
  if (!value) return 0;
  const match = value.trim().match(/^(\d+)/);
  if (!match) return 0;
  const n = Number.parseInt(match[1], 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function defaultAudioOptions(): AudioOptions {
  return {
    target: "",
    caption: "",
    start: 0,
    end: 0,
    options: {
      autoplay: false,
      loop: false,
      nocontrols: false,
    },
  };
}

function buildOptionsString(flags: AudioOptionFlags): string {
  const tokens: string[] = [];
  if (flags.autoplay) tokens.push("autoplay");
  if (flags.loop) tokens.push("loop");
  if (flags.nocontrols) tokens.push("nocontrols");
  return tokens.join(",");
}

export function serializeAudioBlock(options: AudioOptions): string {
  const target = options.target.trim();
  if (!target) return "";

  const named: string[] = [];
  if (options.start > 0) named.push(`start=${options.start}`);
  if (options.end > 0) named.push(`end=${options.end}`);
  const opts = buildOptionsString(options.options);
  if (opts) named.push(`opts="${escapeAttr(opts)}"`);

  const macroLine = `audio::${target}[${named.join(",")}]`;
  const caption = options.caption.trim();
  return caption ? `.${caption}\n${macroLine}` : macroLine;
}

export function parseAudioMacroLine(lineText: string, caption = ""): ParsedAudioMacro | null {
  const match = lineText.trim().match(/^audio::(.+?)\[(.*)?\]$/);
  if (!match) return null;

  const target = match[1].trim();
  const attrs = splitAttrs(match[2] ?? "");

  const parsed: Record<string, string> = {};
  const flags: AudioOptionFlags = {
    autoplay: false,
    loop: false,
    nocontrols: false,
  };

  for (const attr of attrs) {
    const named = attr.match(/^([a-zA-Z0-9_-]+)\s*=\s*(.+)$/);
    if (named) {
      const key = named[1].toLowerCase();
      const value = stripWrappedQuotes(named[2]);
      if (key === "opts" || key === "options") {
        for (const tok of value.split(",").map((s) => s.trim()).filter(Boolean)) {
          const lower = tok.toLowerCase();
          if (lower === "autoplay") flags.autoplay = true;
          else if (lower === "loop") flags.loop = true;
          else if (lower === "nocontrols") flags.nocontrols = true;
          // `controls` is the default; ignore. `muted`/`modest` are video-only.
        }
      } else {
        parsed[key] = value;
      }
    }
    // Audio macros don't define positional attributes; ignore unnamed tokens.
  }

  return {
    target,
    caption,
    start: parseIntFlexible(parsed.start),
    end: parseIntFlexible(parsed.end),
    options: flags,
    isRemote: /^https?:\/\//i.test(target),
  };
}
