import { Handle, Position, NodeProps } from "@xyflow/react";
import { useState } from "react";

export function DecisionNode({ data, id }: NodeProps) {
  const [editing, setEditing] = useState(false);
  const label = (data as any)?.label ?? "Decisão?";

  return (
    <div className="relative" style={{ width: 160, height: 100 }} onDoubleClick={() => setEditing(true)}>
      <div
        className="absolute inset-0 border-2 border-amber-500/70 bg-amber-100/70 dark:bg-amber-500/20 shadow-sm"
        style={{ transform: "rotate(45deg) scale(0.7071)", transformOrigin: "center" }}
      />
      <div className="absolute inset-0 grid place-items-center px-3 text-center text-[12px] font-medium text-foreground">
        {editing ? (
          <input
            autoFocus
            defaultValue={label}
            onBlur={(e) => { (data as any).onLabelChange?.(id, e.target.value); setEditing(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") { (data as any).onLabelChange?.(id, (e.target as HTMLInputElement).value); setEditing(false); } }}
            className="w-[110px] bg-transparent text-center outline-none"
          />
        ) : (
          <span className="break-words leading-tight">{label}</span>
        )}
      </div>
      <Handle id="top" type="target" position={Position.Top} className="!h-2 !w-2 !bg-amber-500 !border-background" />
      <Handle id="yes" type="source" position={Position.Right} className="!h-2 !w-2 !bg-emerald-500 !border-background" style={{ right: -4 }}>
      </Handle>
      <Handle id="no" type="source" position={Position.Bottom} className="!h-2 !w-2 !bg-rose-500 !border-background" />
      <Handle id="left" type="source" position={Position.Left} className="!h-2 !w-2 !bg-amber-500 !border-background" />
    </div>
  );
}
