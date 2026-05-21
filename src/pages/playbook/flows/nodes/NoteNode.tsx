import { NodeProps, NodeResizer } from "@xyflow/react";
import { useState } from "react";

export function NoteNode({ data, selected, id }: NodeProps) {
  const [editing, setEditing] = useState(false);
  const label = (data as any)?.label ?? "Anotação";

  return (
    <div
      onDoubleClick={() => setEditing(true)}
      className="relative min-w-[160px] min-h-[70px] rounded-sm bg-yellow-200 dark:bg-yellow-300 px-3 py-2 text-[12px] text-zinc-800 shadow-md"
      style={{ boxShadow: "2px 3px 6px rgba(0,0,0,0.15)" }}
    >
      <NodeResizer isVisible={selected} minWidth={140} minHeight={60} lineClassName="border-yellow-600" handleClassName="bg-yellow-600 border-background" />
      {editing ? (
        <textarea
          autoFocus
          defaultValue={label}
          onBlur={(e) => { (data as any).onLabelChange?.(id, e.target.value); setEditing(false); }}
          className="w-full h-full bg-transparent outline-none resize-none"
        />
      ) : (
        <div className="whitespace-pre-wrap leading-snug">{label}</div>
      )}
    </div>
  );
}
