import { describe, expect, it } from "vitest";
import { DEFAULT_WALLPAPER } from "@/lib/wallpaper";
import { DEFAULT_EDITOR_LAYOUT_SETTINGS, MAX_EDITOR_PADDING } from "./editorDefaults";
import {
  normalizeProjectEditor,
  resolveProjectMedia,
  validateProjectData,
} from "./projectPersistence";

describe("normalizeProjectEditor", () => {
  it("keeps current bundled /wallp/ wallpaper values", () => {
    const normalized = normalizeProjectEditor({ wallpaper: "/wallp/14.jpg" });

    expect(normalized.wallpaper).toBe("/wallp/14.jpg");
  });

  it("rewrites legacy packaged wallpaper file URLs to current bundled paths", () => {
    const normalized = normalizeProjectEditor({
      wallpaper: "file:///C:/Program Files/foOm/resources/assets/wallpapers/wallpaper14.jpg",
    });

    expect(normalized.wallpaper).toBe("/wallp/wallpaper14.jpg");
  });

  it("rewrites legacy dev wallp file URLs to current bundled paths", () => {
    const normalized = normalizeProjectEditor({
      wallpaper:
        "file:///C:/Users/Harsh/Desktop/Projects/ZoOmly/apps/desktop/ui-react/public/wallp/14.jpg",
    });

    expect(normalized.wallpaper).toBe("/wallp/14.jpg");
  });

  it("falls back for unknown legacy bundled wallpaper filenames", () => {
    const normalized = normalizeProjectEditor({
      wallpaper: "file:///C:/Program Files/foOm/resources/assets/wallpapers/wallpaper999.jpg",
    });

    expect(normalized.wallpaper).toBe(DEFAULT_WALLPAPER);
  });

  it("repairs the accidental oversized default padding on load", () => {
    const normalized = normalizeProjectEditor({ padding: 38 });

    expect(normalized.padding).toBe(DEFAULT_EDITOR_LAYOUT_SETTINGS.padding);
  });

  it("clamps saved padding to the supported editor range", () => {
    const normalized = normalizeProjectEditor({ padding: 80 });

    expect(normalized.padding).toBe(MAX_EDITOR_PADDING);
  });
});

describe("native recording documents", () => {
  it("accepts Rust recording metadata as loadable project media", () => {
    const document = {
      documentVersion: 1,
      media: {
        rawVideoPath: "C:\\Users\\Harsh\\Videos\\foom\\recordings\\proj_123.mp4",
        metadataPath: "C:\\Users\\Harsh\\Videos\\foom\\recordings\\proj_123.json",
        cameraVideoPath: "C:\\Users\\Harsh\\Videos\\foom\\recordings\\proj_123_webcam.webm",
      },
      editor: {},
    };

    expect(validateProjectData(document)).toBe(true);
    expect(resolveProjectMedia(document)).toEqual({
      screenVideoPath: "C:\\Users\\Harsh\\Videos\\foom\\recordings\\proj_123.mp4",
      webcamVideoPath: "C:\\Users\\Harsh\\Videos\\foom\\recordings\\proj_123_webcam.webm",
    });
  });
});
