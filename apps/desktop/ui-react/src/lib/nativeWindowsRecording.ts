export type NativeWindowsSourceType = "display" | "window" | "region";

export type NativeWindowsRecordingRequest = {
  recordingId?: number;
  source: {
    type: NativeWindowsSourceType;
    sourceId: string;
    displayId?: number;
    windowHandle?: string;
    /** Selected bounds in physical desktop pixels, including negative monitor origins. */
    region?: { x: number; y: number; width: number; height: number };
  };
  video: {
    fps: number;
    width: number;
    height: number;
  };
  audio: {
    system: {
      enabled: boolean;
    };
    microphone: {
      enabled: boolean;
      deviceId?: string;
      deviceName?: string;
      gain: number;
    };
  };
  webcam: {
    enabled: boolean;
    deviceId?: string;
    deviceName?: string;
    directShowClsid?: string;
    width: number;
    height: number;
    fps: number;
  };
  cursor: {
    mode: import("./recordingSession").CursorCaptureMode;
  };
};

export type NativeWindowsRecordingStartResult = {
  success: boolean;
  recordingId?: number;
  path?: string;
  helperPath?: string;
  error?: string;
};

export function parseWindowHandleFromSourceId(sourceId?: string | null) {
  if (!sourceId?.startsWith("window:")) {
    return null;
  }

  const handlePart = sourceId.split(":")[1];
  if (!handlePart || !/^\d+$/.test(handlePart)) {
    return null;
  }

  return handlePart;
}
