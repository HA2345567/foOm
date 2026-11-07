import { describe, expect, it, vi } from "vitest";
import { extractMono16kFromVideoUrl, transcribeMono16kToSegments } from "./captioning";

describe("captioning availability", () => {
  it("reports the missing transcription engine instead of inventing empty audio", async () => {
    await expect(extractMono16kFromVideoUrl("blob:recording")).rejects.toThrow(
      "no transcription engine",
    );
  });

  it("does not report fake transcription progress or success", async () => {
    const onStatus = vi.fn();
    await expect(
      transcribeMono16kToSegments(new Float32Array(16000), { onStatus }),
    ).rejects.toThrow("Add captions manually");
    expect(onStatus).not.toHaveBeenCalled();
  });
});
