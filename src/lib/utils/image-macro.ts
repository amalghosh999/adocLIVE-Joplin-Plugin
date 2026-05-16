import { deriveImageAlt, isLocalImageTarget } from "./image-target";
import { parseAsciiDocAttributeList } from "../../shared/asciidoc-attributes";

export interface ImageInsertOptions {
  target: string;
  alt: string;
  title: string;
  caption: string;
  width: number;
  height: number;
  widthUnit?: "" | "px" | "%";
  heightUnit?: "" | "px" | "%";
  widthSpecified?: boolean;
  heightSpecified?: boolean;
  align: "center" | "left" | "right";
  captionPosition: "below" | "left" | "right";
  id?: string;
  roles?: string[];
  options?: string[];
  link?: string;
  window?: string;
  float?: "" | "left" | "right";
  format?: string;
  scaledWidth?: string;
  imagesdir?: string;
}

export interface ParsedImageMacro extends ImageInsertOptions {
  source: "web" | "local";
  resolvedTarget: string;
}

function escapeImageAttr(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function parseImageDimension(rawValue: string | undefined): { value: number; unit: "" | "px" | "%"; specified: boolean } {
  if (!rawValue?.trim()) return { value: 0, unit: "", specified: false };
  const match = rawValue.trim().match(/^(\d+(?:\.\d+)?)/);
  if (!match) return { value: 0, unit: "", specified: false };
  const numeric = Math.round(Number.parseFloat(match[1]));
  if (!Number.isFinite(numeric) || numeric <= 0) return { value: 0, unit: "", specified: false };
  const unit = rawValue.trim().endsWith("%") ? "%" : "px";
  return { value: numeric, unit, specified: true };
}

function resolveImagesdirTarget(target: string, imagesdir: string): string {
  const trimmedImagesdir = imagesdir.trim().replace(/\/+$/, "");
  if (!trimmedImagesdir) return target;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(target) || target.startsWith(":")) return target;
  return `${trimmedImagesdir}/${target.replace(/^\/+/, "")}`;
}

export function parseImageMacroLine(lineText: string, caption = "", documentAttributes?: Map<string, string>): ParsedImageMacro | null {
  const trimmed = lineText.trim();
  const match = trimmed.match(/^image::(.+?)\[(.*)?\]$/);
  if (!match) return null;

  const rawTarget = match[1].trim();
  const parsedAttrs = parseAsciiDocAttributeList(match[2] ?? "");
  const macroImagesdir = parsedAttrs.named.get("imagesdir") || "";
  const effectiveImagesdir = macroImagesdir || documentAttributes?.get("imagesdir") || "";
  const resolvedTarget = resolveImagesdirTarget(rawTarget, effectiveImagesdir);
  const parsed: Record<string, string> = {
    alt: deriveImageAlt(rawTarget),
    align: "center",
  };

  for (const [key, value] of parsedAttrs.named) {
    parsed[key] = value;
  }
  if (parsedAttrs.positional[0]?.trim()) parsed.alt = parsedAttrs.positional[0].trim();
  if (parsedAttrs.positional[1]?.trim() && !parsed.width) parsed.width = parsedAttrs.positional[1].trim();
  if (parsedAttrs.positional[2]?.trim() && !parsed.height) parsed.height = parsedAttrs.positional[2].trim();

  const alignValue = (parsed.align || "center").toLowerCase();
  const align = alignValue === "left" || alignValue === "right" ? alignValue : "center";

  const cpValue = (parsed["caption-position"] || "below").toLowerCase();
  const captionPosition = cpValue === "left" || cpValue === "right" ? cpValue : "below";
  const width = parseImageDimension(parsed.width);
  const height = parseImageDimension(parsed.height);
  const floatValue = (parsed.float || "").toLowerCase();
  const imageFloat = floatValue === "left" || floatValue === "right" ? floatValue : "";

  return {
    target: rawTarget,
    resolvedTarget,
    alt: parsed.alt || deriveImageAlt(rawTarget),
    title: parsed.title || "",
    caption: parsed.caption || caption,
    width: width.value,
    height: height.value,
    widthUnit: width.unit,
    heightUnit: height.unit,
    widthSpecified: width.specified,
    heightSpecified: height.specified,
    align,
    captionPosition,
    source: isLocalImageTarget(resolvedTarget) ? "local" : "web",
    id: parsedAttrs.id,
    roles: parsedAttrs.roles,
    options: [...parsedAttrs.options],
    link: parsed.link || "",
    window: parsed.window || "",
    float: imageFloat,
    format: parsed.format || "",
    scaledWidth: parsed.scaledwidth || "",
    imagesdir: macroImagesdir,
  };
}

function serializeImageDimension(value: number, unit: "" | "px" | "%" | undefined, specified: boolean | undefined): string {
  if (specified === undefined) {
    return value && value !== 100 ? `${value}${unit || "%"}` : "";
  }
  if (!specified || !value) return "";
  return unit === "%" ? `${value}%` : String(value);
}

export function serializeImageBlock(options: ImageInsertOptions): string {
  const target = options.target.trim();
  if (!target) return "";

  const attrs: string[] = [];
  const altText = options.alt.trim();
  const titleText = options.title.trim();
  const captionText = options.caption.trim();

  if (options.id) attrs.push(`id="${escapeImageAttr(options.id)}"`);
  if (options.roles?.length) attrs.push(`role="${escapeImageAttr(options.roles.join(" "))}"`);
  if (options.options?.length) attrs.push(`opts="${escapeImageAttr(options.options.join(","))}"`);
  if (altText) attrs.push(`alt="${escapeImageAttr(altText)}"`);
  const width = serializeImageDimension(options.width, options.widthUnit, options.widthSpecified);
  const height = serializeImageDimension(options.height, options.heightUnit, options.heightSpecified);
  if (width) attrs.push(`width="${width}"`);
  if (height) attrs.push(`height="${height}"`);
  attrs.push(`align="${options.align}"`);
  if (options.captionPosition && options.captionPosition !== "below") {
    attrs.push(`caption-position="${options.captionPosition}"`);
  }
  if (titleText) attrs.push(`title="${escapeImageAttr(titleText)}"`);
  if (options.link) attrs.push(`link="${escapeImageAttr(options.link)}"`);
  if (options.window) attrs.push(`window="${escapeImageAttr(options.window)}"`);
  if (options.float) attrs.push(`float="${options.float}"`);
  if (options.format) attrs.push(`format="${escapeImageAttr(options.format)}"`);
  if (options.scaledWidth) attrs.push(`scaledwidth="${escapeImageAttr(options.scaledWidth)}"`);
  if (options.imagesdir) attrs.push(`imagesdir="${escapeImageAttr(options.imagesdir)}"`);

  const imageLine = `image::${target}[${attrs.join(",")}]`;
  return captionText ? `.${captionText}\n${imageLine}` : imageLine;
}
