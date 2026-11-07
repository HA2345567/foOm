import { useEffect, useState } from "react";
import type { CursorTelemetryPoint } from "@/components/video-editor/types";
import { nativeBridgeClient } from "../client";

interface UseCursorTelemetryResult {
  samples: CursorTelemetryPoint[];
  loading: boolean;
  error: string | null;
}

export function useCursorTelemetry(videoPath: string | null): UseCursorTelemetryResult {
  const [samples, setSamples] = useState<CursorTelemetryPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedPath, setLoadedPath] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadCursorTelemetry() {
      if (!videoPath) {
        setSamples([]);
        setLoading(false);
        setError(null);
        setLoadedPath(null);
        return;
      }

      setLoading(true);
      setLoadedPath(null);
      setSamples([]);
      setError(null);

      try {
        const nextSamples = await nativeBridgeClient.cursor.getTelemetry(videoPath);
        if (!cancelled) {
          setSamples(nextSamples);
          setLoadedPath(videoPath);
        }
      } catch (nextError) {
        if (!cancelled) {
          setSamples([]);
          setLoadedPath(videoPath);
          setError(
            nextError instanceof Error ? nextError.message : "Failed to load cursor telemetry",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadCursorTelemetry();

    return () => {
      cancelled = true;
    };
  }, [videoPath]);

  return {
    samples: loadedPath === videoPath ? samples : [],
    loading: Boolean(videoPath) && (loading || loadedPath !== videoPath),
    error,
  };
}
