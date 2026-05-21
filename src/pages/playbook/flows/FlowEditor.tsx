import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, MarkerType,
  addEdge, applyNodeChanges, applyEdgeChanges, useReactFlow,
  Connection, Edge, Node, NodeChange, EdgeChange, BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toPng } from "html-to-image";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
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
  { type: "decision", label: "Decisão", icon: Diamond, size: { width: 160, height: 100 } },
  { type: "subprocess", label: "Subprocesso", icon: Layers, size: { width: 180, height: 60 } },
  { type: "end", label: "Fim", icon: Circle, size: { width: 120, height: 44 } },
  { type: "note", label: "Anotação", icon: StickyNote, size: { width: 180, height: 80 } },
  { type: "lane", label: "Raia", icon: Columns3, size: { width: 320, height: 360 } },
] as const;

function Inner({ nodes, edges, viewport, onChange }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, getViewport } = useReactFlow();

  const updateLabel = useCallback((id: string, label: string) => {
    const next = nodes.map(n => n.id === id ? { ...n, data: { ...n.data, label } } : n);
    onChange({ nodes: next, edges, viewport: getViewport() });
  }, [nodes, edges, onChange, getViewport]);

  const hydratedNodes = useMemo(
    () => nodes.map(n => ({ ...n, data: { ...n.data, onLabelChange: updateLabel } })),
    [nodes, updateLabel]
  );

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const next = applyNodeChanges(changes, nodes);
    onChange({ nodes: next, edges, viewport: getViewport() });
  }, [nodes, edges, onChange, getViewport]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const next = applyEdgeChanges(changes, edges);
    onChange({ nodes, edges: next, viewport: getViewport() });
  }, [nodes, edges, onChange, getViewport]);

  const onConnect = useCallback((conn: Connection) => {
    let label: string | undefined;
    if (conn.sourceHandle === "yes") label = "Sim";
    if (conn.sourceHandle === "no") label = "Não";
    const next = addEdge({
      ...conn,
      type: "smoothstep",
      animated: false,
      label,
      markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
      style: { strokeWidth: 1.6 },
    }, edges);
    onChange({ nodes, edges: next, viewport: getViewport() });
  }, [nodes, edges, onChange, getViewport]);

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
    onChange({ nodes: [...nodes, newNode], edges, viewport: getViewport() });
  };

  async function exportPng() {
    const el = wrapperRef.current?.querySelector(".react-flow__viewport") as HTMLElement | null;
    const container = wrapperRef.current?.querySelector(".react-flow") as HTMLElement | null;
    if (!container) return;
    try {
      const dataUrl = await toPng(container, { backgroundColor: "#ffffff", pixelRatio: 2, cacheBust: true });
      const a = document.createElement("a");
      a.href = dataUrl; a.download = "fluxo.png"; a.click();
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
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={NODE_TYPES}
          defaultViewport={viewport}
          fitView={nodes.length > 0}
          snapToGrid
          snapGrid={[16, 16]}
          deleteKeyCode={["Backspace", "Delete"]}
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
