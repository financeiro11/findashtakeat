import { Handle, Position, NodeProps } from "@xyflow/react";
import { useState } from "react";

export function DecisionNode({ data, id, selected }: NodeProps) {
  const [editing, setEditing] = useState(false);
  const label = (data as any)?.label ?? "Decisão?";
  const W = 180, H = 110;

  return (
    <div
      className="relative"
      style={{ width: W, height: H }}
      onDoubleClick={() => setEditing(true)}
    >
      <svg
        className="absolute inset-0 overflow-visible"
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
      >
        <defs>
          <linearGradient id={`dg-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fef9c3" />
            <stop offset="100%" stopColor="#fde68a" />
          </linearGradient>
          <filter id={`ds-${id}`} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" floodColor="#000" floodOpacity="0.12" />
          </filter>
        </defs>
        <polygon
          points={`${W / 2},4 ${W - 4},${H / 2} ${W / 2},${H - 4} 4,${H / 2}`}
          fill={`url(#dg-${id})`}
          stroke={selected ? "#b45309" : "#d97706"}
          strokeWidth={selected ? 2 : 1.5}
          filter={`url(#ds-${id})`}
        />
      </svg>

      <div className="absolute inset-0 grid place-items-center px-10 text-center pointer-events-none">
        {editing ? (
          <input
            autoFocus
            defaultValue={label}
            onBlur={(e) => { (data as any).onLabelChange?.(id, e.target.value); setEditing(false); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { (data as any).onLabelChange?.(id, (e.target as HTMLInputElement).value); setEditing(false); }
              if (e.key === "Escape") setEditing(false);
            }}
            className="w-[110px] bg-transparent text-center outline-none text-[12px] font-medium pointer-events-auto"
          />
        ) : (
          <span className="text-[12px] font-medium leading-tight text-foreground break-words">
            {label}
          </span>
        )}
      </div>

      {/* Branch labels */}
      <span className="absolute -right-1 top-1/2 translate-x-full -translate-y-1/2 ml-1 text-[10px] font-semibold text-emerald-600 bg-background/80 px-1 rounded pointer-events-none">
        Sim
      </span>
      <span className="absolute left-1/2 -translate-x-1/2 -bottom-1 translate-y-full mt-1 text-[10px] font-semibold text-rose-600 bg-background/80 px-1 rounded pointer-events-none">
        Não
      </span>

      <Handle id="top" type="target" position={Position.Top} className="!h-2.5 !w-2.5 !bg-primary !border-2 !border-background" />
      <Handle id="yes" type="source" position={Position.Right} className="!h-2.5 !w-2.5 !bg-emerald-500 !border-2 !border-background" />
      <Handle id="no" type="source" position={Position.Bottom} className="!h-2.5 !w-2.5 !bg-rose-500 !border-2 !border-background" />
      <Handle id="left" type="source" position={Position.Left} className="!h-2.5 !w-2.5 !bg-primary !border-2 !border-background" />
    </div>
  );
}
