"use client";
/**
 * CriminalNetworkGraph — SAKSHYA-compliant Three-Ink Graph
 *  - SOLID BLACK edges = Observed (proven from CDR / Bank / structured data)
 *  - DASHED BLUE edges = Predicted (AI-inferred from FIR text via LLM)
 *  - DOTTED ORANGE edges = Hypothesised (investigator-accepted ghost link)
 *
 * Node colors:
 *  - Red = KINGPIN | Yellow = BROKER | Green = EXECUTOR
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

// @ts-ignore
import "@xyflow/react/dist/style.css";

import type { NetworkNode, NetworkEdge } from "@shared/types";

const ROLE_COLOR: Record<string, string> = {
  KINGPIN: "#dc2626",
  BROKER: "#eab308",
  EXECUTOR: "#16a34a",
  default: "#64748b",
};

// ---- THREE-INK EDGE CLASSIFICATION ----
function classifyEdge(edge: NetworkEdge): "observed" | "predicted" | "hypothesised" {
  const evidence = (edge.evidence || "").toLowerCase();

  // Hypothesised: investigator manually accepted a ghost link
  if (evidence.includes("investigator-accepted") || evidence.includes("ghost link")) {
    return "hypothesised";
  }

  // Observed: from structured sources (CDR row / Bank txn)
  if (
    evidence.includes("cdr row") ||
    evidence.includes("inr @") ||
    evidence.includes("duration:") ||
    edge.relationType === "phone_call" ||
    edge.relationType === "financial_transfer"
  ) {
    return "observed";
  }

  // Predicted: extracted from FIR text (LLM/co-occurrence)
  return "predicted";
}

const EDGE_STYLES = {
  observed: {
    stroke: "#111827",
    strokeWidth: 2.5,
    strokeDasharray: undefined,
    labelColor: "#111827",
  },
  predicted: {
    stroke: "#2563eb",
    strokeWidth: 1.8,
    strokeDasharray: "6 3",
    labelColor: "#1e40af",
  },
  hypothesised: {
    stroke: "#ea580c",
    strokeWidth: 1.8,
    strokeDasharray: "2 4",
    labelColor: "#9a3412",
  },
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
          x: typeof n.x === "number" && n.x !== 0 ? n.x : 60 + (i % 5) * 140,
          y: typeof n.y === "number" && n.y !== 0 ? n.y : 60 + Math.floor(i / 5) * 120,
        },
        data: { label: n.label, role: n.role, kingpinScore: n.kingpinScore, node: n },
      })),
    [nodes]
  );

  const flowEdges: Edge[] = useMemo(
    () =>
      edges.map((e) => {
        const inkType = classifyEdge(e);
        const style = EDGE_STYLES[inkType];
        const isFinancial = e.relationType === "financial_transfer";

        return {
          id: e.id,
          source: e.sourceId,
          target: e.targetId,
          label:
            inkType === "hypothesised"
              ? `⚡ ${e.relationType.replace(/_/g, " ")}`
              : e.relationType.replace(/_/g, " "),
          animated: isFinancial,
          markerEnd: { type: MarkerType.ArrowClosed, color: style.stroke },
          style: {
            stroke: style.stroke,
            strokeWidth: style.strokeWidth,
            strokeDasharray: style.strokeDasharray,
          },
          labelStyle: {
            fontSize: 10,
            fill: style.labelColor,
            fontWeight: 600,
          },
          labelBgStyle: {
            fill: "#ffffff",
            fillOpacity: 0.9,
          },
        };
      }),
    [edges]
  );

  // Counts for the SAKSHYA legend
  const edgeCounts = useMemo(() => {
    const counts = { observed: 0, predicted: 0, hypothesised: 0 };
    for (const e of edges) counts[classifyEdge(e)]++;
    return counts;
  }, [edges]);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const meta = node.data as unknown as EntityNodeData;
      if (meta.node && onNodeClick) onNodeClick(meta.node);
    },
    [onNodeClick]
  );

  return (
    <div className="relative h-[520px] w-full rounded-xl border bg-slate-50">
      {/* ---- SAKSHYA Three-Ink Legend ---- */}
      <div className="absolute top-3 right-3 z-10 rounded-lg bg-white/95 p-3 shadow-md border border-slate-200 text-xs">
        <div className="mb-2 font-bold text-slate-900">Three-Ink Legend</div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <svg width="24" height="4">
              <line x1="0" y1="2" x2="24" y2="2" stroke="#111827" strokeWidth="2.5" />
            </svg>
            <span>Observed ({edgeCounts.observed})</span>
          </div>
          <div className="flex items-center gap-2">
            <svg width="24" height="4">
              <line x1="0" y1="2" x2="24" y2="2" stroke="#2563eb" strokeWidth="1.8" strokeDasharray="6 3" />
            </svg>
            <span>Predicted ({edgeCounts.predicted})</span>
          </div>
          <div className="flex items-center gap-2">
            <svg width="24" height="4">
              <line x1="0" y1="2" x2="24" y2="2" stroke="#ea580c" strokeWidth="1.8" strokeDasharray="2 4" />
            </svg>
            <span>Hypothesised ({edgeCounts.hypothesised})</span>
          </div>
        </div>
      </div>

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