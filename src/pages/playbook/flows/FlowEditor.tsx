import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, MarkerType,
  addEdge, applyNodeChanges, applyEdgeChanges, useReactFlow, getNodesBounds,
  Connection, Edge, Node, NodeChange, EdgeChange, BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toPng } from "html-to-image";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Download, FileCode2, Square, Diamond, Circle, StickyNote, Layers, Columns3 } from "lucide-react";
import { StepNode } from "./nodes/StepNode";
import { DecisionNode } from "./nodes/DecisionNode";
import { StartEndNode } from "./nodes/StartEndNode";
import { SubprocessNode } from "./nodes/SubprocessNode";
import { NoteNode } from "./nodes/NoteNode";
import { LaneNode } from "./nodes/LaneNode";
import { flowToMermaid } from "./mermaid";

type Props = {
  nodes: Node[];
  edges: Edge[];
  viewport: { x: number; y: number; zoom: number };
  title?: string;
  onChange: (next: { nodes: Node[]; edges: Edge[]; viewport: { x: number; y: number; zoom: number } }) => void;
};

const NODE_TYPES = {
  step: StepNode,
  decision: DecisionNode,
  start: StartEndNode,
  end: StartEndNode,
  subprocess: SubprocessNode,
  note: NoteNode,
  lane: LaneNode,
};

const PALETTE = [
  { type: "start", label: "Início", icon: Circle, size: { width: 120, height: 44 } },
  { type: "step", label: "Etapa", icon: Square, size: { width: 160, height: 56 } },
  { type: "decision", label: "Decisão", icon: Diamond, size: { width: 180, height: 110 } },
  { type: "subprocess", label: "Subprocesso", icon: Layers, size: { width: 180, height: 60 } },
  { type: "end", label: "Fim", icon: Circle, size: { width: 120, height: 44 } },
  { type: "note", label: "Anotação", icon: StickyNote, size: { width: 180, height: 80 } },
  { type: "lane", label: "Raia", icon: Columns3, size: { width: 320, height: 360 } },
] as const;

type Snapshot = { nodes: Node[]; edges: Edge[] };

const EDGE_COLOR = "hsl(var(--muted-foreground))";

const DEFAULT_NODE_SIZE: Record<string, { width: number; height: number }> = {
  start: { width: 120, height: 44 },
  end: { width: 120, height: 44 },
  step: { width: 160, height: 56 },
  decision: { width: 180, height: 110 },
  subprocess: { width: 180, height: 60 },
  note: { width: 180, height: 80 },
  lane: { width: 320, height: 360 },
};

function numericSize(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function nodeWithExportSize(node: Node): Node {
  const fallback = DEFAULT_NODE_SIZE[node.type ?? "step"] ?? DEFAULT_NODE_SIZE.step;
  const measured = (node as any).measured ?? {};
  const width = numericSize((node.style as any)?.width) ?? (node as any).width ?? measured.width ?? fallback.width;
  const height = numericSize((node.style as any)?.height) ?? (node as any).height ?? measured.height ?? fallback.height;
  return { ...node, width, height } as Node;
}

function Inner({ nodes, edges, viewport, title, onChange }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, getViewport } = useReactFlow();

  // ---- Undo / Redo history ----
  const past = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);
  const latest = useRef<Snapshot>({ nodes, edges });
  useEffect(() => { latest.current = { nodes, edges }; }, [nodes, edges]);

  const pushHistory = useCallback(() => {
    past.current.push({
      nodes: latest.current.nodes.map(n => ({ ...n, position: { ...n.position } })),
      edges: latest.current.edges.map(e => ({ ...e })),
    });
    if (past.current.length > 100) past.current.shift();
    future.current = [];
  }, []);

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(latest.current);
    onChange({ nodes: prev.nodes, edges: prev.edges, viewport: getViewport() });
  }, [onChange, getViewport]);

  const redo = useCallback(() => {
    const nxt = future.current.pop();
    if (!nxt) return;
    past.current.push(latest.current);
    onChange({ nodes: nxt.nodes, edges: nxt.edges, viewport: getViewport() });
  }, [onChange, getViewport]);

  // ---- Clipboard (copy / paste / duplicate) ----
  const clipboard = useRef<Snapshot | null>(null);

  const copySelection = useCallback(() => {
    const selNodes = latest.current.nodes.filter(n => n.selected);
    if (selNodes.length === 0) return false;
    const ids = new Set(selNodes.map(n => n.id));
    const selEdges = latest.current.edges.filter(e => ids.has(e.source) && ids.has(e.target));
    clipboard.current = {
      nodes: selNodes.map(n => ({ ...n, position: { ...n.position }, data: { ...n.data } })),
      edges: selEdges.map(e => ({ ...e })),
    };
    return true;
  }, []);

  const pasteClipboard = useCallback(() => {
    const cb = clipboard.current;
    if (!cb || cb.nodes.length === 0) return;
    const offset = 24;
    const idMap = new Map<string, string>();
    const newNodes: Node[] = cb.nodes.map(n => {
      const newId = `n_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      idMap.set(n.id, newId);
      return {
        ...n,
        id: newId,
        position: { x: n.position.x + offset, y: n.position.y + offset },
        selected: true,
        data: { ...n.data },
      };
    });
    const newEdges: Edge[] = cb.edges.map(e => ({
      ...e,
      id: `e_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      source: idMap.get(e.source) ?? e.source,
      target: idMap.get(e.target) ?? e.target,
      selected: false,
    }));
    pushHistory();
    const merged = latest.current.nodes.map(n => ({ ...n, selected: false }));
    onChange({
      nodes: [...merged, ...newNodes],
      edges: [...latest.current.edges, ...newEdges],
      viewport: getViewport(),
    });
  }, [onChange, getViewport, pushHistory]);

  const duplicateSelection = useCallback(() => {
    if (copySelection()) pasteClipboard();
  }, [copySelection, pasteClipboard]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      if (!meta) return;
      const k = e.key.toLowerCase();
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); redo(); }
      else if (k === "c") { if (copySelection()) e.preventDefault(); }
      else if (k === "v") { if (clipboard.current) { e.preventDefault(); pasteClipboard(); } }
      else if (k === "d") { e.preventDefault(); duplicateSelection(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, copySelection, pasteClipboard, duplicateSelection]);

  const updateLabel = useCallback((id: string, label: string) => {
    pushHistory();
    const next = nodes.map(n => n.id === id ? { ...n, data: { ...n.data, label } } : n);
    onChange({ nodes: next, edges, viewport: getViewport() });
  }, [nodes, edges, onChange, getViewport, pushHistory]);

  const hydratedNodes = useMemo(
    () => nodes.map(n => ({ ...n, data: { ...n.data, onLabelChange: updateLabel } })),
    [nodes, updateLabel]
  );

  const hydratedEdges = useMemo<Edge[]>(
    () => edges.map(edge => ({
      ...edge,
      type: edge.type ?? "smoothstep",
      markerEnd: edge.markerEnd && typeof edge.markerEnd === "object"
        ? { ...edge.markerEnd, color: EDGE_COLOR }
        : { type: MarkerType.ArrowClosed, width: 18, height: 18, color: EDGE_COLOR },
      style: { ...(edge.style ?? {}), stroke: EDGE_COLOR, strokeWidth: 1.8 },
      labelStyle: { fill: "hsl(var(--foreground))", fontSize: 11, fontWeight: 700, ...(edge.labelStyle ?? {}) },
      labelBgStyle: { fill: "hsl(var(--background))", fillOpacity: 0.95, ...(edge.labelBgStyle ?? {}) },
      labelBgPadding: edge.labelBgPadding ?? ([4, 2] as [number, number]),
      labelBgBorderRadius: edge.labelBgBorderRadius ?? 4,
    })),
    [edges]
  );

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    if (changes.some(c => c.type === "remove")) pushHistory();
    const next = applyNodeChanges(changes, nodes);
    onChange({ nodes: next, edges, viewport: getViewport() });
  }, [nodes, edges, onChange, getViewport, pushHistory]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (changes.some(c => c.type === "remove")) pushHistory();
    const next = applyEdgeChanges(changes, edges);
    onChange({ nodes, edges: next, viewport: getViewport() });
  }, [nodes, edges, onChange, getViewport, pushHistory]);

  const onNodeDragStart = useCallback(() => { pushHistory(); }, [pushHistory]);

  const onConnect = useCallback((conn: Connection) => {
    pushHistory();
    let label: string | undefined;
    if (conn.sourceHandle === "yes") label = "Sim";
    if (conn.sourceHandle === "no") label = "Não";
    const next = addEdge({
      ...conn,
      type: "smoothstep",
      animated: false,
      label,
      markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: EDGE_COLOR },
      style: { stroke: EDGE_COLOR, strokeWidth: 1.8 },
      labelStyle: { fill: "hsl(var(--foreground))", fontSize: 11, fontWeight: 700 },
      labelBgStyle: { fill: "hsl(var(--background))", fillOpacity: 0.95 },
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 4,
    }, edges);
    onChange({ nodes, edges: next, viewport: getViewport() });
  }, [nodes, edges, onChange, getViewport, pushHistory]);

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData("application/x-flow-node");
    if (!raw) return;
    const { type, label, width, height } = JSON.parse(raw);
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const newNode: Node = {
      id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type,
      position,
      data: { label },
      ...(type === "lane" || type === "subprocess" || type === "note" ? { style: { width, height } } : {}),
    };
    pushHistory();
    onChange({ nodes: [...nodes, newNode], edges, viewport: getViewport() });
  };

  async function exportPng() {
    const viewportEl = wrapperRef.current?.querySelector(".react-flow__viewport") as HTMLElement | null;
    if (!viewportEl || nodes.length === 0) { toast.error("Nada para exportar"); return; }
    const padding = 80;
    const exportNodes = nodes.map(nodeWithExportSize);
    const bounds = getNodesBounds(exportNodes);
    // Extra room so labels positioned outside node bounds (ex: "Sim"/"Não") não sejam cortadas
    const extra = 48;
    const width = Math.ceil(bounds.width + padding * 2 + extra * 2);
    const height = Math.ceil(bounds.height + padding * 2 + extra * 2);
    const tx = -bounds.x + padding + extra;
    const ty = -bounds.y + padding + extra;
    try {
      const dataUrl = await toPng(viewportEl, {
        backgroundColor: "#ffffff",
        width,
        height,
        pixelRatio: 2,
        cacheBust: true,
        style: {
          width: `${width}px`,
          height: `${height}px`,
          transform: `translate(${tx}px, ${ty}px) scale(1)`,
          transformOrigin: "0 0",
        },
        filter: (node) => {
          if (!(node instanceof HTMLElement)) return true;
          const cls = node.classList;
          if (!cls) return true;
          if (
            cls.contains("react-flow__handle") ||
            cls.contains("react-flow__minimap") ||
            cls.contains("react-flow__controls") ||
            cls.contains("react-flow__background") ||
            cls.contains("react-flow__attribution") ||
            cls.contains("react-flow__panel")
          ) return false;
          return true;
        },
      });
      const safe = (title ?? "fluxo").trim().replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, "_") || "fluxo";
      const a = document.createElement("a");
      a.href = dataUrl; a.download = `fluxo_${safe}.png`; a.click();
      toast.success("PNG exportado");
    } catch (err: any) {
      toast.error("Falha ao exportar PNG", { description: err?.message });
    }
  }

  function exportMermaid() {
    const txt = flowToMermaid(nodes, edges);
    navigator.clipboard.writeText(txt);
    toast.success("Mermaid copiado para a área de transferência");
  }

  return (
    <div className="flex h-full">
      {/* Palette */}
      <aside className="w-48 shrink-0 border-r bg-background/60 p-2.5 overflow-y-auto">
        <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide px-1 mb-1.5">Blocos</div>
        <div className="space-y-1">
          {PALETTE.map(p => {
            const Icon = p.icon;
            return (
              <div
                key={p.type}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/x-flow-node", JSON.stringify({ type: p.type, label: p.label, width: p.size.width, height: p.size.height }));
                  e.dataTransfer.effectAllowed = "move";
                }}
                className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5 cursor-grab active:cursor-grabbing text-[13px] hover:bg-muted/60 hover:border-primary/40 transition-colors"
              >
                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                <span>{p.label}</span>
              </div>
            );
          })}
        </div>
        <div className="mt-4 text-[10.5px] leading-relaxed text-muted-foreground px-1">
          Arraste blocos para o canvas. Duplo-clique edita o texto. Conecte arrastando das bolinhas.
        </div>
      </aside>

      {/* Canvas */}
      <div className="flex-1 relative" ref={wrapperRef} onDrop={onDrop} onDragOver={onDragOver}>
        <div className="absolute top-2 right-2 z-10 flex gap-1.5">
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={exportMermaid}>
            <FileCode2 className="h-3.5 w-3.5" /> Mermaid
          </Button>
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={exportPng}>
            <Download className="h-3.5 w-3.5" /> PNG
          </Button>
        </div>
        <ReactFlow
          nodes={hydratedNodes}
          edges={hydratedEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDragStart={onNodeDragStart}
          nodeTypes={NODE_TYPES}
          defaultViewport={viewport}
          fitView={nodes.length > 0}
          snapToGrid
          snapGrid={[16, 16]}
          deleteKeyCode={["Backspace", "Delete"]}
          multiSelectionKeyCode={["Shift", "Meta", "Control"]}
          selectionKeyCode="Shift"
          panOnDrag
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          <Controls className="!shadow-md" />
          <MiniMap pannable zoomable className="!bg-background !border" />
        </ReactFlow>
      </div>
    </div>
  );
}

export function FlowEditor(props: Props) {
  return (
    <ReactFlowProvider>
      <Inner {...props} />
    </ReactFlowProvider>
  );
}
