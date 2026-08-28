"use client";
/**
 * CriminalNetworkGraph — interactive React Flow canvas.
 *  - Nodes colored by role: red=KINGPIN, yellow=BROKER, green=EXECUTOR
 *  - Edge labels show relation type; financial_transfer edges animate
 *  - MiniMap + Controls; click a node to open the suspect detail drawer
 */
import { useCallback, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
  type NodeTypes,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { NetworkNode, NetworkEdge } from "@shared/types";

const ROLE_COLOR: Record<string, string> = {
  KINGPIN: "#dc2626",
  BROKER: "#eab308",
  EXECUTOR: "#16a34a",
  default: "#64748b",
};

interface EntityNodeData {
  label: string;
  role: string;
  kingpinScore: number;
  node?: NetworkNode;
}

function EntityNode({ data }: NodeProps) {
  const d = data as unknown as EntityNodeData;
  const color = ROLE_COLOR[d.role] ?? ROLE_COLOR.default;
  return (
    <div
      className="rounded-lg border-2 bg-white px-3 py-2 shadow-md"
      style={{ borderColor: color, minWidth: 110 }}
    >
      <Handle type="target" position={Position.Top} />
      <div className="text-center">
        <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-slate-800">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
          {d.label}
        </div>
        <div className="mt-0.5 text-[10px] font-medium" style={{ color }}>
          {d.role} · {Math.round(d.kingpinScore)}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const nodeTypes: NodeTypes = { entity: EntityNode };

export interface GraphClick {
  node: NetworkNode | null;
}

export function CriminalNetworkGraph({
  nodes,
  edges,
  onNodeClick,
}: {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  onNodeClick?: (node: NetworkNode) => void;
}) {
  const flowNodes: Node[] = useMemo(
    () =>
      nodes.map((n, i) => ({
        id: n.id,
        type: "entity",
        position: {
          // seeded positions, else auto-layout in a grid
          x: typeof n.x === "number" && n.x !== 0 ? n.x : 60 + (i % 5) * 140,
          y: typeof n.y === "number" && n.y !== 0 ? n.y : 60 + Math.floor(i / 5) * 120,
        },
        data: { label: n.label, role: n.role, kingpinScore: n.kingpinScore, node: n },
      })),
    [nodes]
  );

  const flowEdges: Edge[] = useMemo(
    () =>
      edges.map((e) => ({
        id: e.id,
        source: e.sourceId,
        target: e.targetId,
        label: e.relationType.replace(/_/g, " "),
        animated: e.relationType === "financial_transfer", // animated money flows
        markerEnd: { type: MarkerType.ArrowClosed },
        style: {
          stroke: e.relationType === "financial_transfer" ? "#dc2626" : "#94a3b8",
          strokeWidth: Math.min(1 + e.weight, 5),
        },
        labelStyle: { fontSize: 10, fill: "#64748b" },
        labelBgStyle: { fill: "#ffffff", fillOpacity: 0.85 },
      })),
    [edges]
  );

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const meta = node.data as unknown as EntityNodeData;
      if (meta.node && onNodeClick) onNodeClick(meta.node);
    },
    [onNodeClick]
  );

  return (
    <div className="h-[520px] w-full rounded-xl border bg-slate-50">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        fitView
        minZoom={0.2}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} />
        <Controls />
        <MiniMap
          nodeColor={(n) => {
            const r = (n.data as unknown as EntityNodeData).role ?? "default";
            return ROLE_COLOR[r] ?? ROLE_COLOR.default ?? "#64748b";
          }}
          maskColor="rgba(0,0,0,0.05)"
        />
      </ReactFlow>
    </div>
  );
}
