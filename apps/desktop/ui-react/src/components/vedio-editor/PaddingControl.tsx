import { useId, useState } from "react";
import { maxCanvasPadding, paddingSides, uniformPadding, type PaddingEdges } from "@/lib/canvasPadding";

interface Props {
  label: string;
  value: number;
  edges?: PaddingEdges;
  disabled: boolean;
  onChange?: (value: number) => void;
  onEdgesChange?: (edges: PaddingEdges) => void;
  onCommit?: () => void;
}

export function PaddingControl({ label, value, edges, disabled, onChange, onEdgesChange, onCommit }: Props) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const sides = edges ?? uniformPadding(value);
  const mixed = paddingSides.some(side => sides[side] !== sides.top);
  const linkedValue = Math.round(paddingSides.reduce((sum, side) => sum + sides[side], 0) / 4);
  const rangeStyle = "w-full min-w-0 h-4 cursor-pointer accent-zinc-200 disabled:opacity-40";

  return (
    <div className="foom-canvas-padding-control space-y-2">
      <div className="foom-canvas-control-heading">
        <label htmlFor={id}>{label}</label>
        <button type="button" aria-expanded={expanded} aria-controls={id + "-edges"}
          className="foom-canvas-advanced-button"
          disabled={disabled} onClick={() => setExpanded(!expanded)}>
          {expanded ? "Hide advanced" : "Advanced"}
        </button>
      </div>
      <div className="foom-canvas-padding-track flex items-center gap-3 rounded-lg px-3 py-1.5">
        <input id={id} type="range" min={0} max={maxCanvasPadding} step={1}
          title="Set padding on all four sides" disabled={disabled}
          value={disabled ? 0 : linkedValue} className={rangeStyle}
          onChange={e => onChange?.(e.currentTarget.valueAsNumber)}
          onPointerUp={onCommit} onKeyUp={onCommit} onBlur={onCommit} />
        <output htmlFor={id} className="foom-canvas-value min-w-8 text-right font-mono text-[10px]">
          {disabled ? "—" : mixed ? "Mixed" : sides.top + "%"}
        </output>
      </div>
      {disabled && <p className="text-[10px] text-zinc-400">Vertical stack fills the canvas.</p>}
      {expanded && !disabled && (
        <div id={id + "-edges"} className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-md border border-white/10 p-2">
          {paddingSides.map(side => (
            <label key={side} className="min-w-0 text-[10px] text-zinc-400">
              <span className="flex items-center justify-between"><span className="capitalize">{side}</span><span>{sides[side]}%</span></span>
              <input type="range" aria-label={side + " padding"} min={0} max={maxCanvasPadding}
                step={1} value={sides[side]} className={rangeStyle}
                onChange={e => onEdgesChange?.({ ...sides, [side]: e.currentTarget.valueAsNumber })}
                onPointerUp={onCommit} onKeyUp={onCommit} onBlur={onCommit} />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
