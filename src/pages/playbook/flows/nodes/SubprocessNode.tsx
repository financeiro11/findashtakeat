import { Handle, Position, NodeProps, NodeResizer } from "@xyflow/react";
import { useState } from "react";

export function SubprocessNode({ data, selected, id }: NodeProps) {
  const [editing, setEditing] = useState(false);
  const label = (data as any)?.label ?? "Subprocesso";

  return (
    <div
      onDoubleClick={() => setEditing(true)}
      className="relative min-w-[160px] min-h-[60px] rounded-md border-2 border-violet-500/70 bg-violet-500/10 px-4 py-2.5 text-center text-[13px] font-medium text-foreground shadow-sm"
      style={{ boxShadow: "inset 0 0 0 4px hsl(var(--background)), 0 1px 3px rgba(0,0,0,0.06)" }}
    >
      <NodeResizer isVisible={selected} minWidth={140} minHeight={56} lineClassName="border-violet-500" handleClassName="bg-violet-500 border-background" />
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !bg-violet-500 !border-background" />
      {editing ? (
        <input
          autoFocus
          defaultValue={label}
          onBlur={(e) => { (data as any).onLabelChange?.(id, e.target.value); setEditing(false); }}
          onKeyDown={(e) => { if (e.key === "Enter") { (data as any).onLabelChange?.(id, (e.target as HTMLInputElement).value); setEditing(false); } }}
          className="w-full bg-transparent text-center outline-none"
        />
      ) : (
        <span>{label}</span>
      )}
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !bg-violet-500 !border-background" />
    </div>
  );
}
