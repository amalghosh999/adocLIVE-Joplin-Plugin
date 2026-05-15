/**
 * Video macro serialization, parsing, and YouTube/Vimeo URL detection.
 *
 * AsciiDoc video macro forms (per https://docs.asciidoctor.org/asciidoc/latest/macros/audio-and-video/):
 *   - Local file:    `video::path/to/clip.mp4[<named-attrs>]`
 *   - YouTube embed: `video::<id>[youtube,<theme?>,<lang?>,<list?>,<playlist?>,<named-attrs>]`
 *   - Vimeo embed:   `video::<id>[vimeo,<named-attrs>]`
 *   - Direct remote: `video::https://example.com/clip.mp4[<named-attrs>]`
 *
 * Block title (caption) is the line `.Caption text` immediately above the macro.
 */

export type VideoService = "youtube" | "vimeo" | null;

export interface VideoOptions {
  /** A local path, an external direct URL, or the bare YouTube/Vimeo ID when service is set. */
  target: string;
  /** Hosting service for embed targets. `null` means the target is a file path or direct URL. */
  service: VideoService;
  /** Block title (`.Caption` line above the macro). */
  caption: string;
  /** Pixel width (omitted when 0). */
  width: number;
  /** Pixel height (omitted when 0). */
  height: number;
  /** Start offset in seconds (0 = omit). */
  start: number;
  /** End offset in seconds (0 = omit). */
  end: number;
  /** YouTube poster image (local or absolute URL). Empty = omit. */
  poster: string;
  /** YouTube theme: "" | "dark" | "light". Empty = omit. */
  theme: string;
  /** YouTube BCP-47 lang code, e.g. "fr". Empty = omit. */
  lang: string;
  /** YouTube playlist ID for the `list=` attribute. Empty = omit. */
  list: string;
  /** YouTube dynamic-playlist video IDs (comma-separated). Empty = omit. */
  playlist: string;
  /** Block alignment passthrough. */
  align: "" | "left" | "center" | "right";
  /** Boolean playback options that map to AsciiDoc `opts="..."`. */
  options: VideoOptionFlags;
}

export interface VideoOptionFlags {
  autoplay: boolean;
  loop: boolean;
  /** YouTube only — modest branding. */
  modest: boolean;
  /** Disables player controls. */
  nocontrols: boolean;
  /** Disables fullscreen on YouTube. */
  nofullscreen: boolean;
  /** Mute by default. */
  muted: boolean;
}

export interface ParsedVideoMacro extends VideoOptions {
  /** True iff `target` plus `service` form a valid hosting embed. */
  isEmbed: boolean;
  /** Convenience flag: true when target is `https://`/`http://` and service is null. */
  isRemote: boolean;
}

/** Result of `parseEmbedUrl`. */
export interface EmbedUrlInfo {
  service: "youtube" | "vimeo";
  id: string;
  /** YouTube playlist ID extracted from `?list=…` (only for YouTube). */
  list?: string;
  /** Start offset extracted from `?t=` or `?start=` (seconds, only for YouTube). */
  start?: number;
}

const WHITESPACE_RE = /\s+/g;

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

/**
 * Detect a YouTube or Vimeo URL and pull out the canonical video ID. Returns
 * `null` for unrecognized hosts so the caller can fall through to a direct
 * remote URL or local-path branch.
 *
 * Recognised forms:
 *   YouTube:
 *     - https://www.youtube.com/watch?v=<id>[&list=<pl>][&t=<sec>]
 *     - https://youtu.be/<id>[?t=<sec>]
 *     - https://www.youtube.com/embed/<id>
 *     - https://www.youtube.com/shorts/<id>
 *   Vimeo:
 *     - https://vimeo.com/<numericId>
 *     - https://player.vimeo.com/video/<id>
 */
export function parseEmbedUrl(value: string): EmbedUrlInfo | null {
  const raw = (value || "").trim();
  if (!raw) return null;

  // Allow protocol-relative or scheme-less inputs by attaching https://.
  let urlText = raw;
  if (!/^https?:\/\//i.test(urlText)) {
    if (urlText.startsWith("//")) urlText = `https:${urlText}`;
    else if (/^(www\.)?(youtube\.com|youtu\.be|vimeo\.com|player\.vimeo\.com)\b/i.test(urlText)) {
      urlText = `https://${urlText}`;
    } else {
      return null;
    }
  }

  let url: URL;
  try {
    url = new URL(urlText);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./i, "").toLowerCase();
  const idLike = (s: string) => /^[A-Za-z0-9_-]+$/.test(s);

  // ── YouTube ────────────────────────────────────────────────────────────
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
    const segs = url.pathname.split("/").filter(Boolean);
    let id = "";
    if (segs[0] === "watch") {
      id = url.searchParams.get("v") ?? "";
    } else if (segs[0] === "embed" && segs[1]) {
      id = segs[1];
    } else if (segs[0] === "shorts" && segs[1]) {
      id = segs[1];
    } else if (url.searchParams.has("v")) {
      id = url.searchParams.get("v") ?? "";
    }
    if (!id || !idLike(id)) return null;
    const list = url.searchParams.get("list") ?? undefined;
    const startRaw = url.searchParams.get("t") ?? url.searchParams.get("start") ?? undefined;
    const startSec = startRaw ? parseYouTubeTimestamp(startRaw) : undefined;
    return {
      service: "youtube",
      id,
      ...(list && idLike(list) ? { list } : {}),
      ...(typeof startSec === "number" && startSec > 0 ? { start: startSec } : {}),
    };
  }
  if (host === "youtu.be") {
    const id = url.pathname.replace(/^\//, "").split("/")[0];
    if (!id || !idLike(id)) return null;
    const startRaw = url.searchParams.get("t") ?? url.searchParams.get("start") ?? undefined;
    const startSec = startRaw ? parseYouTubeTimestamp(startRaw) : undefined;
    return {
      service: "youtube",
      id,
      ...(typeof startSec === "number" && startSec > 0 ? { start: startSec } : {}),
    };
  }

  // ── Vimeo ─────────────────────────────────────────────────────────────
  if (host === "vimeo.com") {
    const seg = url.pathname.split("/").filter(Boolean)[0] ?? "";
    if (!/^\d+$/.test(seg)) return null;
    return { service: "vimeo", id: seg };
  }
  if (host === "player.vimeo.com") {
    const segs = url.pathname.split("/").filter(Boolean);
    if (segs[0] === "video" && segs[1] && /^\d+$/.test(segs[1])) {
      return { service: "vimeo", id: segs[1] };
    }
    return null;
  }

  return null;
}

/** Parse YouTube-style timestamps: "90", "90s", "1m30s", "1h2m3s". */
function parseYouTubeTimestamp(value: string): number {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  const match = trimmed.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/i);
  if (!match) return 0;
  const h = Number.parseInt(match[1] ?? "0", 10);
  const m = Number.parseInt(match[2] ?? "0", 10);
  const s = Number.parseInt(match[3] ?? "0", 10);
  return h * 3600 + m * 60 + s;
}

export function defaultVideoOptions(): VideoOptions {
  return {
    target: "",
    service: null,
    caption: "",
    width: 0,
    height: 0,
    start: 0,
    end: 0,
    poster: "",
    theme: "",
    lang: "",
    list: "",
    playlist: "",
    align: "",
    options: {
      autoplay: false,
      loop: false,
      modest: false,
      nocontrols: false,
      nofullscreen: false,
      muted: false,
    },
  };
}

function buildOptionsString(flags: VideoOptionFlags): string {
  const tokens: string[] = [];
  if (flags.autoplay) tokens.push("autoplay");
  if (flags.loop) tokens.push("loop");
  if (flags.modest) tokens.push("modest");
  if (flags.muted) tokens.push("muted");
  if (flags.nocontrols) tokens.push("nocontrols");
  if (flags.nofullscreen) tokens.push("nofullscreen");
  return tokens.join(",");
}

/**
 * Emit a `video::TARGET[ATTRS]` macro line, with optional preceding `.Caption`.
 * Service-prefixed forms put the service name as the first positional attr,
 * matching the AsciiDoc spec.
 */
export function serializeVideoBlock(options: VideoOptions): string {
  const target = options.target.trim();
  if (!target) return "";

  const positional: string[] = [];
  const named: string[] = [];

  if (options.service === "youtube" || options.service === "vimeo") {
    positional.push(options.service);
  } else if (options.poster.trim()) {
    // Local/remote files — `poster` may go positional (1st) per the spec.
    positional.push(options.poster.trim());
  }

  if (options.width > 0) named.push(`width=${options.width}`);
  if (options.height > 0) named.push(`height=${options.height}`);
  if (options.start > 0) named.push(`start=${options.start}`);
  if (options.end > 0) named.push(`end=${options.end}`);

  if (options.service === "youtube") {
    if (options.theme.trim()) named.push(`theme=${options.theme.trim()}`);
    if (options.lang.trim()) named.push(`lang=${options.lang.trim().replace(WHITESPACE_RE, "")}`);
    if (options.list.trim()) named.push(`list=${options.list.trim()}`);
    if (options.playlist.trim()) {
      const cleaned = options.playlist.split(",").map((s) => s.trim()).filter(Boolean).join(",");
      if (cleaned) named.push(`playlist="${escapeAttr(cleaned)}"`);
    }
  }

  if (options.align) named.push(`align=${options.align}`);

  const opts = buildOptionsString(options.options);
  if (opts) named.push(`opts="${opts}"`);

  const allAttrs = [...positional, ...named].join(",");
  const macroLine = `video::${target}[${allAttrs}]`;
  const caption = options.caption.trim();
  return caption ? `.${caption}\n${macroLine}` : macroLine;
}

const FIRST_POSITIONAL_SERVICES = new Set(["youtube", "vimeo"]);

/**
 * Parse a single `video::TARGET[ATTRS]` line. Caption is fed in separately by
 * the caller (since the `.Caption` line is on a different row).
 */
export function parseVideoMacroLine(lineText: string, caption = ""): ParsedVideoMacro | null {
  const match = lineText.trim().match(/^video::(.+?)\[(.*)?\]$/);
  if (!match) return null;

  const target = match[1].trim();
  const attrs = splitAttrs(match[2] ?? "");

  const parsed: Record<string, string> = {};
  const flags: VideoOptionFlags = {
    autoplay: false,
    loop: false,
    modest: false,
    nocontrols: false,
    nofullscreen: false,
    muted: false,
  };

  let service: VideoService = null;
  let posterFromPositional = "";
  let positionalCounter = 0;

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
          else if (lower === "modest") flags.modest = true;
          else if (lower === "muted") flags.muted = true;
          else if (lower === "nocontrols") flags.nocontrols = true;
          else if (lower === "nofullscreen") flags.nofullscreen = true;
        }
      } else {
        parsed[key] = value;
      }
      continue;
    }

    // Positional: service name in slot 1 if recognised; else slot 1 is poster
    // (per the spec); slots 2/3 are width/height for local/remote files.
    const lower = attr.toLowerCase();
    if (positionalCounter === 0 && FIRST_POSITIONAL_SERVICES.has(lower)) {
      service = lower as VideoService;
    } else if (positionalCounter === 0) {
      posterFromPositional = stripWrappedQuotes(attr);
    } else if (positionalCounter === 1 && !parsed.width) {
      parsed.width = stripWrappedQuotes(attr);
    } else if (positionalCounter === 2 && !parsed.height) {
      parsed.height = stripWrappedQuotes(attr);
    }
    positionalCounter += 1;
  }

  const align = (parsed.align || "").toLowerCase();
  const isRemote = service === null && /^https?:\/\//i.test(target);

  return {
    target,
    service,
    caption,
    width: parseIntFlexible(parsed.width),
    height: parseIntFlexible(parsed.height),
    start: parseIntFlexible(parsed.start),
    end: parseIntFlexible(parsed.end),
    poster: parsed.poster ?? posterFromPositional,
    theme: parsed.theme ?? "",
    lang: parsed.lang ?? "",
    list: parsed.list ?? "",
    playlist: parsed.playlist ?? "",
    align: align === "left" || align === "center" || align === "right" ? align : "",
    options: flags,
    isEmbed: service !== null,
    isRemote,
  };
}
