import { NodeProps, NodeResizer } from "@xyflow/react";
import { useState } from "react";

export function LaneNode({ data, selected, id }: NodeProps) {
  const [editing, setEditing] = useState(false);
  const label = (data as any)?.label ?? "Responsável";

  return (
    <div className="relative w-full h-full rounded-md border-2 border-dashed border-sky-400/60 bg-sky-500/5">
      <NodeResizer isVisible={selected} minWidth={240} minHeight={200} lineClassName="border-sky-400" handleClassName="bg-sky-500 border-background" />
      <div
        onDoubleClick={() => setEditing(true)}
        className="absolute top-0 left-0 right-0 px-3 py-1.5 bg-sky-500/15 text-sky-900 dark:text-sky-200 text-[12px] font-semibold uppercase tracking-wide border-b border-sky-400/40"
      >
        {editing ? (
          <input
            autoFocus
            defaultValue={label}
            onBlur={(e) => { (data as any).onLabelChange?.(id, e.target.value); setEditing(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") { (data as any).onLabelChange?.(id, (e.target as HTMLInputElement).value); setEditing(false); } }}
            className="w-full bg-transparent outline-none"
          />
        ) : (
          <span>{label}</span>
        )}
      </div>
    </div>
  );
}
