import { NodeProps, NodeResizer } from "@xyflow/react";
import { useState } from "react";

const LANE_COLORS: Record<string, {
  border: string; bg: string; headerBg: string; headerText: string; handle: string; line: string;
}> = {
  sky:     { border: "border-sky-400/60",     bg: "bg-sky-500/5",     headerBg: "bg-sky-500/15",     headerText: "text-sky-900 dark:text-sky-200",     handle: "bg-sky-500 border-background",     line: "border-sky-400" },
  emerald: { border: "border-emerald-400/60", bg: "bg-emerald-500/5", headerBg: "bg-emerald-500/15", headerText: "text-emerald-900 dark:text-emerald-200", handle: "bg-emerald-500 border-background", line: "border-emerald-400" },
  amber:   { border: "border-amber-400/60",   bg: "bg-amber-500/5",   headerBg: "bg-amber-500/15",   headerText: "text-amber-900 dark:text-amber-200",   handle: "bg-amber-500 border-background",   line: "border-amber-400" },
  rose:    { border: "border-rose-400/60",    bg: "bg-rose-500/5",    headerBg: "bg-rose-500/15",    headerText: "text-rose-900 dark:text-rose-200",    handle: "bg-rose-500 border-background",    line: "border-rose-400" },
  violet:  { border: "border-violet-400/60",  bg: "bg-violet-500/5",  headerBg: "bg-violet-500/15",  headerText: "text-violet-900 dark:text-violet-200",  handle: "bg-violet-500 border-background",  line: "border-violet-400" },
  slate:   { border: "border-slate-400/60",   bg: "bg-slate-500/5",   headerBg: "bg-slate-500/15",   headerText: "text-slate-900 dark:text-slate-200",   handle: "bg-slate-500 border-background",   line: "border-slate-400" },
};

const SWATCH: Record<string, string> = {
  sky: "bg-sky-500",
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  violet: "bg-violet-500",
  slate: "bg-slate-500",
};

export function LaneNode({ data, selected, id }: NodeProps) {
  const [editing, setEditing] = useState(false);
  const label = (data as any)?.label ?? "Responsável";
  const colorKey = ((data as any)?.color as string) || "sky";
  const c = LANE_COLORS[colorKey] ?? LANE_COLORS.sky;
  const setColor = (data as any)?.onColorChange as ((id: string, color: string) => void) | undefined;

  return (
    <div className={`relative w-full h-full rounded-md border-2 border-dashed ${c.border} ${c.bg}`}>
      <NodeResizer isVisible={selected} minWidth={240} minHeight={200} lineClassName={c.line} handleClassName={c.handle} />
      <div
        onDoubleClick={() => setEditing(true)}
        className={`absolute top-0 left-0 right-0 px-3 py-1.5 ${c.headerBg} ${c.headerText} text-[12px] font-semibold uppercase tracking-wide border-b ${c.border} flex items-center gap-2`}
      >
        {editing ? (
          <input
            autoFocus
            defaultValue={label}
            onBlur={(e) => { (data as any).onLabelChange?.(id, e.target.value); setEditing(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") { (data as any).onLabelChange?.(id, (e.target as HTMLInputElement).value); setEditing(false); } }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className="nodrag nopan flex-1 bg-transparent outline-none"
          />
        ) : (
          <span className="flex-1 truncate">{label}</span>
        )}
        {selected && setColor && (
          <div className="nodrag nopan flex items-center gap-1">
            {Object.keys(LANE_COLORS).map(k => (
              <button
                key={k}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); setColor(id, k); }}
                title={k}
                className={`h-3 w-3 rounded-full ring-1 ring-background/80 ${SWATCH[k]} ${k === colorKey ? "outline outline-2 outline-foreground/60" : ""}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
