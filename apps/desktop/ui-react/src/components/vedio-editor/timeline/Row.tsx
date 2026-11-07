import type { RowDefinition } from "dnd-timeline";
import { useRow } from "dnd-timeline";
import type { ReactNode } from "react";

interface RowProps extends RowDefinition {
  children: React.ReactNode;
  hint?: string;
  isEmpty?: boolean;
  background?: ReactNode;
}

export default function Row({ id, children, hint, isEmpty, background }: RowProps) {
  const { setNodeRef, rowWrapperStyle, rowStyle } = useRow({ id });

  return (
    <div
      className="border-b border-white/[0.055] bg-[#141414] relative overflow-hidden"
      style={{ ...rowWrapperStyle, minHeight: 36 }}
    >
      {background && (
        <div className="absolute inset-0 pointer-events-none">{background}</div>
      )}
      {isEmpty && hint && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none z-10">
          <span className="text-[11px] text-white/50 font-medium">{hint}</span>
        </div>
      )}
      <div ref={setNodeRef} style={rowStyle}>
        {children}
      </div>
    </div>
  );
}
