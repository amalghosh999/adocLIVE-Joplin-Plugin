import { describe, expect, it } from "vitest";
import {
  defaultVideoOptions,
  parseEmbedUrl,
  parseVideoMacroLine,
  serializeVideoBlock,
} from "../../src/lib/utils/video-macro";

describe("parseEmbedUrl", () => {
  it("recognises canonical YouTube watch URLs", () => {
    expect(parseEmbedUrl("https://www.youtube.com/watch?v=RvRhUHTV_8k"))
      .toEqual({ service: "youtube", id: "RvRhUHTV_8k" });
  });

  it("extracts a YouTube playlist via the `list=` query param", () => {
    expect(parseEmbedUrl("https://www.youtube.com/watch?v=ABC&list=PL123"))
      .toEqual({ service: "youtube", id: "ABC", list: "PL123" });
  });

  it("handles youtu.be short URLs and `t=` start offsets", () => {
    expect(parseEmbedUrl("https://youtu.be/abc123XYZ?t=90"))
      .toEqual({ service: "youtube", id: "abc123XYZ", start: 90 });
  });

  it("handles YouTube embed and shorts URLs", () => {
    expect(parseEmbedUrl("https://www.youtube.com/embed/dQw4w9WgXcQ"))
      .toEqual({ service: "youtube", id: "dQw4w9WgXcQ" });
    expect(parseEmbedUrl("https://www.youtube.com/shorts/abc123"))
      .toEqual({ service: "youtube", id: "abc123" });
  });

  it("recognises Vimeo URLs (numeric ID required)", () => {
    expect(parseEmbedUrl("https://vimeo.com/67480300"))
      .toEqual({ service: "vimeo", id: "67480300" });
    expect(parseEmbedUrl("https://player.vimeo.com/video/67480300"))
      .toEqual({ service: "vimeo", id: "67480300" });
    // Non-numeric Vimeo path is rejected.
    expect(parseEmbedUrl("https://vimeo.com/something")).toBeNull();
  });

  it("returns null for unrelated hosts and non-URLs", () => {
    expect(parseEmbedUrl("https://example.com/clip.mp4")).toBeNull();
    expect(parseEmbedUrl("just some text")).toBeNull();
    expect(parseEmbedUrl("")).toBeNull();
  });

  it("parses YouTube hh/mm/ss timestamps", () => {
    expect(parseEmbedUrl("https://youtu.be/abc?t=1m30s"))
      .toMatchObject({ start: 90 });
  });
});

describe("serializeVideoBlock", () => {
  it("emits a YouTube macro with service as the first positional attribute", () => {
    expect(serializeVideoBlock({
      ...defaultVideoOptions(),
      service: "youtube",
      target: "RvRhUHTV_8k",
    })).toBe("video::RvRhUHTV_8k[youtube]");
  });

  it("includes width/height/start/end as named attributes after service", () => {
    expect(serializeVideoBlock({
      ...defaultVideoOptions(),
      service: "youtube",
      target: "ABC",
      width: 640,
      height: 360,
      start: 60,
    })).toBe("video::ABC[youtube,width=640,height=360,start=60]");
  });

  it("emits opts=\"…\" with autoplay/loop/nocontrols/muted/modest/nofullscreen", () => {
    const out = serializeVideoBlock({
      ...defaultVideoOptions(),
      service: "youtube",
      target: "ABC",
      options: {
        autoplay: true,
        loop: true,
        modest: true,
        muted: true,
        nocontrols: true,
        nofullscreen: true,
      },
    });
    expect(out).toBe('video::ABC[youtube,opts="autoplay,loop,modest,muted,nocontrols,nofullscreen"]');
  });

  it("emits Vimeo macros without YouTube-only attributes", () => {
    expect(serializeVideoBlock({
      ...defaultVideoOptions(),
      service: "vimeo",
      target: "67480300",
      width: 800,
    })).toBe("video::67480300[vimeo,width=800]");
  });

  it("emits a local file macro with optional poster as the first positional", () => {
    expect(serializeVideoBlock({
      ...defaultVideoOptions(),
      service: null,
      target: "clip.mp4",
      poster: "thumb.jpg",
      width: 800,
    })).toBe("video::clip.mp4[thumb.jpg,width=800]");
  });

  it("prefixes the macro with .Caption when caption is set", () => {
    expect(serializeVideoBlock({
      ...defaultVideoOptions(),
      target: "clip.mp4",
      caption: "A walkthrough",
    })).toBe(".A walkthrough\nvideo::clip.mp4[]");
  });

  it("returns an empty string when target is blank", () => {
    expect(serializeVideoBlock({ ...defaultVideoOptions(), target: "  " })).toBe("");
  });
});

describe("parseVideoMacroLine", () => {
  it("round-trips a YouTube macro", () => {
    const parsed = parseVideoMacroLine("video::RvRhUHTV_8k[youtube,width=640]");
    expect(parsed?.service).toBe("youtube");
    expect(parsed?.target).toBe("RvRhUHTV_8k");
    expect(parsed?.width).toBe(640);
    expect(parsed?.isEmbed).toBe(true);
  });

  it("recognises Vimeo macros", () => {
    const parsed = parseVideoMacroLine("video::67480300[vimeo]");
    expect(parsed?.service).toBe("vimeo");
    expect(parsed?.target).toBe("67480300");
  });

  it("classifies remote URLs as `isRemote` (no service)", () => {
    const parsed = parseVideoMacroLine("video::https://example.com/clip.mp4[]");
    expect(parsed?.service).toBe(null);
    expect(parsed?.isRemote).toBe(true);
  });

  it("parses opts=\"autoplay,loop\" into option flags", () => {
    const parsed = parseVideoMacroLine('video::clip.mp4[opts="autoplay,loop,nocontrols"]');
    expect(parsed?.options.autoplay).toBe(true);
    expect(parsed?.options.loop).toBe(true);
    expect(parsed?.options.nocontrols).toBe(true);
  });

  it("returns null for non-video lines", () => {
    expect(parseVideoMacroLine("image::cat.png[]")).toBeNull();
    expect(parseVideoMacroLine("")).toBeNull();
  });
});
