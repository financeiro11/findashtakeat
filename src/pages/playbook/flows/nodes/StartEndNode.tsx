import { Handle, Position, NodeProps } from "@xyflow/react";
import { useState } from "react";

export function StartEndNode({ data, id, type }: NodeProps) {
  const [editing, setEditing] = useState(false);
  const label = (data as any)?.label ?? (type === "start" ? "Início" : "Fim");
  const isStart = type === "start";

  return (
    <div
      onDoubleClick={() => setEditing(true)}
      className={`relative min-w-[120px] rounded-full border-2 px-5 py-2.5 text-center text-[13px] font-semibold shadow-sm ${
        isStart
          ? "border-emerald-500/70 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
          : "border-zinc-500/70 bg-zinc-700/90 text-white"
      }`}
    >
      {isStart ? null : <Handle type="target" position={Position.Top} className="!h-2 !w-2 !bg-zinc-500 !border-background" />}
      {editing ? (
        <input
          autoFocus
          defaultValue={label}
          onBlur={(e) => { (data as any).onLabelChange?.(id, e.target.value); setEditing(false); }}
          onKeyDown={(e) => { if (e.key === "Enter") { (data as any).onLabelChange?.(id, (e.target as HTMLInputElement).value); setEditing(false); } }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          className="nodrag nopan w-full bg-transparent text-center outline-none"
        />
      ) : (
        <span>{label}</span>
      )}
      {isStart && <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !bg-emerald-500 !border-background" />}
    </div>
  );
}
