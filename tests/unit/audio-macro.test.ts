import { describe, expect, it } from "vitest";
import {
  defaultAudioOptions,
  parseAudioMacroLine,
  serializeAudioBlock,
} from "../../src/lib/utils/audio-macro";

describe("serializeAudioBlock", () => {
  it("emits a bare audio macro for a target with no attrs", () => {
    expect(serializeAudioBlock({
      ...defaultAudioOptions(),
      target: "song.mp3",
    })).toBe("audio::song.mp3[]");
  });

  it("emits start/end as named attributes", () => {
    expect(serializeAudioBlock({
      ...defaultAudioOptions(),
      target: "song.mp3",
      start: 30,
      end: 90,
    })).toBe("audio::song.mp3[start=30,end=90]");
  });

  it("emits opts=\"autoplay,loop,nocontrols\" only when set", () => {
    expect(serializeAudioBlock({
      ...defaultAudioOptions(),
      target: "song.mp3",
      options: { autoplay: true, loop: true, nocontrols: true },
    })).toBe('audio::song.mp3[opts="autoplay,loop,nocontrols"]');
  });

  it("prefixes the macro with .Caption when caption is set", () => {
    expect(serializeAudioBlock({
      ...defaultAudioOptions(),
      target: "song.mp3",
      caption: "Take a zen moment",
    })).toBe(".Take a zen moment\naudio::song.mp3[]");
  });

  it("returns an empty string when target is blank", () => {
    expect(serializeAudioBlock({ ...defaultAudioOptions(), target: "" })).toBe("");
  });
});

describe("parseAudioMacroLine", () => {
  it("round-trips a basic local file macro", () => {
    const parsed = parseAudioMacroLine("audio::song.mp3[]");
    expect(parsed?.target).toBe("song.mp3");
    expect(parsed?.start).toBe(0);
    expect(parsed?.options.autoplay).toBe(false);
  });

  it("parses start/end and opts", () => {
    const parsed = parseAudioMacroLine('audio::song.mp3[start=30,end=90,opts="autoplay,loop"]');
    expect(parsed?.start).toBe(30);
    expect(parsed?.end).toBe(90);
    expect(parsed?.options.autoplay).toBe(true);
    expect(parsed?.options.loop).toBe(true);
    expect(parsed?.options.nocontrols).toBe(false);
  });

  it("ignores video-only options like muted/modest in audio macros", () => {
    const parsed = parseAudioMacroLine('audio::song.mp3[opts="autoplay,muted,modest"]');
    expect(parsed?.options.autoplay).toBe(true);
    // muted and modest aren't part of the AudioOptionFlags shape — they're
    // silently ignored.
    expect((parsed?.options as any).muted).toBeUndefined();
    expect((parsed?.options as any).modest).toBeUndefined();
  });

  it("classifies remote URLs as isRemote", () => {
    const parsed = parseAudioMacroLine("audio::https://example.com/song.mp3[]");
    expect(parsed?.isRemote).toBe(true);
  });

  it("returns null for non-audio lines", () => {
    expect(parseAudioMacroLine("video::clip.mp4[]")).toBeNull();
  });
});
