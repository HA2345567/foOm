import { useRef, useState } from "react";
import { Button } from "../ui/button";

type Bounds = { x: number; y: number; width: number; height: number };

/** All geometry is in physical desktop pixels, including negative monitor origins. */
export function RegionPicker({
  bounds,
  name,
  onConfirm,
  onCancel,
}: {
  bounds: Bounds;
  name: string;
  onConfirm: (region: Bounds) => void;
  onCancel: () => void;
}) {
  const [region, setRegion] = useState<Bounds>({
    x: bounds.x + Math.floor(bounds.width / 4),
    y: bounds.y + Math.floor(bounds.height / 4),
    width: Math.max(1, Math.floor(bounds.width / 2)),
    height: Math.max(1, Math.floor(bounds.height / 2)),
  });
  const anchor = useRef<{ x: number; y: number } | null>(null);
  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, Math.round(value)));
  const point = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: clamp(
        bounds.x + ((event.clientX - rect.left) / rect.width) * bounds.width,
        bounds.x,
        bounds.x + bounds.width - 1,
      ),
      y: clamp(
        bounds.y + ((event.clientY - rect.top) / rect.height) * bounds.height,
        bounds.y,
        bounds.y + bounds.height - 1,
      ),
    };
  };
  const update = (field: keyof Bounds, value: number) => {
    if (!Number.isFinite(value)) return;
    setRegion((previous) => {
      const next = { ...previous, [field]: Math.round(value) };
      next.x = clamp(next.x, bounds.x, bounds.x + bounds.width - 1);
      next.y = clamp(next.y, bounds.y, bounds.y + bounds.height - 1);
      next.width = clamp(next.width, 1, bounds.x + bounds.width - next.x);
      next.height = clamp(next.height, 1, bounds.y + bounds.height - next.y);
      return next;
    });
  };
  return (
    <section className="space-y-3 p-3 text-white" aria-label="Choose recording region">
      <p className="text-sm font-medium">Choose a region on {name}</p>
      <p className="text-xs text-zinc-400">Drag on the display map or enter exact pixel bounds.</p>
      <div
        aria-label="Display region map"
        className="relative mx-auto max-w-full touch-none overflow-hidden rounded border border-white/20 bg-zinc-900"
        style={{
          aspectRatio: `${bounds.width} / ${bounds.height}`,
          width: Math.min(480, (170 * bounds.width) / bounds.height),
        }}
        onPointerDown={(event) => {
          anchor.current = point(event);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!anchor.current) return;
          const end = point(event),
            start = anchor.current;
          setRegion({
            x: Math.min(start.x, end.x),
            y: Math.min(start.y, end.y),
            width: Math.max(1, Math.abs(end.x - start.x)),
            height: Math.max(1, Math.abs(end.y - start.y)),
          });
        }}
        onPointerUp={() => {
          anchor.current = null;
        }}
        onPointerCancel={() => {
          anchor.current = null;
        }}
        onLostPointerCapture={() => {
          anchor.current = null;
        }}
      >
        <div
          className="pointer-events-none absolute border-2 border-blue-400 bg-blue-400/25"
          style={{
            left: `${((region.x - bounds.x) / bounds.width) * 100}%`,
            top: `${((region.y - bounds.y) / bounds.height) * 100}%`,
            width: `${(region.width / bounds.width) * 100}%`,
            height: `${(region.height / bounds.height) * 100}%`,
          }}
        />
      </div>
      <div className="grid grid-cols-4 gap-2">
        {(["x", "y", "width", "height"] as const).map((field) => (
          <label key={field} className="text-xs capitalize">
            {field}
            <input
              aria-label={`Region ${field}`}
              type="number"
              value={region[field]}
              onChange={(event) => update(field, event.currentTarget.valueAsNumber)}
              className="mt-1 w-full rounded bg-zinc-800 p-2 text-white"
            />
          </label>
        ))}
      </div>
      <p className="text-xs text-zinc-400">
        {region.width} × {region.height} pixels · desktop position {region.x}, {region.y}
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Back
        </Button>
        <Button onClick={() => onConfirm(region)}>Use region</Button>
      </div>
    </section>
  );
}
