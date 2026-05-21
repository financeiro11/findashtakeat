import { Handle, Position, NodeProps, NodeResizer } from "@xyflow/react";
import { useState } from "react";

export function StepNode({ data, selected, id }: NodeProps) {
  const [editing, setEditing] = useState(false);
  const label = (data as any)?.label ?? "Etapa";

  return (
    <div
      className="group relative min-w-[140px] min-h-[56px] rounded-lg border-2 border-primary/60 bg-primary/10 px-4 py-2.5 text-center text-[13px] font-medium text-foreground shadow-sm transition-shadow hover:shadow-md"
      onDoubleClick={() => setEditing(true)}
    >
      <NodeResizer isVisible={selected} minWidth={120} minHeight={48} lineClassName="border-primary" handleClassName="bg-primary border-background" />
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !bg-primary !border-background" />
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-primary !border-background" />
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
        <span className="break-words">{label}</span>
      )}
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !bg-primary !border-background" />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !bg-primary !border-background" />
    </div>
  );
}
