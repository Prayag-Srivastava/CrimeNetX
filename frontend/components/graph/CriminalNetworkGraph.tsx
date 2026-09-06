"use client";
/**
 * CriminalNetworkGraph — Interactive Explainable Crime Storyline Graph Canvas.
 *  - Dark Midnight High-Tech Criminal Intelligence Canvas
 *  - Zero-Overlap Multi-Subtier Layout: Ensures entity cards and edge labels never collide
 *  - Dynamic 4-Way Dual Handles (Top/Bottom/Left/Right) for Smart React Flow Curve Routing
 *  - Quadratic High/Low Arch Curves for Multi-Hop Edges to Loop Far Above/Below Cards
 *  - Vector Offset & Longitudinal Staggering Algorithm for Zero-Collision Edge Badges
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Node,
  type Edge,
  type NodeProps,
  type NodeTypes,
  type EdgeProps,
  type EdgeTypes,
  type XYPosition,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { NetworkNode, NetworkEdge } from "@shared/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const DEFAULT_THEME = {
  border: "border-indigo-500/80 shadow-[0_0_20px_rgba(99,102,241,0.35)]",
  bg: "bg-indigo-500",
  badgeBg: "bg-indigo-950/80 text-indigo-200 border-indigo-500/50",
  text: "text-indigo-300",
  label: "🏷️ Case Entity",
};

const ROLE_THEME: Record<string, typeof DEFAULT_THEME> = {
  KINGPIN: {
    border: "border-red-500",
    bg: "bg-red-500",
    badgeBg: "bg-red-950/90 text-red-200 border-red-500/60",
    text: "text-red-400",
    label: "👑 Mastermind / Kingpin",
  },
  BROKER: {
    border: "border-amber-500",
    bg: "bg-amber-500",
    badgeBg: "bg-amber-950/90 text-amber-200 border-amber-500/60",
    text: "text-amber-400",
    label: "💼 Key Operative / Broker",
  },
  EXECUTOR: {
    border: "border-emerald-500",
    bg: "bg-emerald-500",
    badgeBg: "bg-emerald-950/90 text-emerald-200 border-emerald-500/60",
    text: "text-emerald-400",
    label: "⚡ Field Executor",
  },
  default: DEFAULT_THEME,
};

interface EntityNodeData {
  label: string;
  role: string;
  kingpinScore: number;
  node?: NetworkNode;
}

const ROLE_HEADER_COLORS: Record<string, { header: string; glow: string; dot: string; score: string; handleColor: string }> = {
  KINGPIN:  { header: "bg-gradient-to-r from-red-700 to-red-900",      glow: "shadow-[0_0_28px_rgba(239,68,68,0.5)]",       dot: "bg-red-400",     score: "bg-red-500",     handleColor: "!bg-red-400" },
  BROKER:   { header: "bg-gradient-to-r from-amber-600 to-amber-900",   glow: "shadow-[0_0_28px_rgba(245,158,11,0.5)]",     dot: "bg-amber-400",   score: "bg-amber-500",   handleColor: "!bg-amber-400" },
  EXECUTOR: { header: "bg-gradient-to-r from-emerald-700 to-emerald-900",glow: "shadow-[0_0_28px_rgba(16,185,129,0.5)]",    dot: "bg-emerald-400", score: "bg-emerald-500", handleColor: "!bg-emerald-400" },
  default:  { header: "bg-gradient-to-r from-indigo-700 to-indigo-900", glow: "shadow-[0_0_28px_rgba(99,102,241,0.4)]",    dot: "bg-indigo-400",  score: "bg-indigo-500",  handleColor: "!bg-indigo-400" },
};

function EntityNode({ data }: NodeProps) {
  const d = data as unknown as EntityNodeData;
  const theme = ROLE_THEME[d.role] ?? DEFAULT_THEME;
  const hTheme = ROLE_HEADER_COLORS[d.role] ?? ROLE_HEADER_COLORS.default!;
  const isPerson = d.role === "KINGPIN" || d.role === "BROKER" || d.role === "EXECUTOR";

  const icon =
    d.role === "KINGPIN"   ? "👑"
    : d.role === "BROKER"  ? "💼"
    : d.role === "EXECUTOR" ? "⚡"
    : d.label.startsWith("98") || d.label.startsWith("97") || d.label.startsWith("99") ? "📱"
    : d.label.includes("MH-")  ? "🚗"
    : d.label.includes("Police") || d.label.includes("Pune") || d.label.includes("Nashik") ? "📍"
    : d.label.match(/^\d{10,}$/) ? "🏦"
    : "🏷️";

  const roleLabel =
    d.role === "KINGPIN"   ? "Command — Mastermind"
    : d.role === "BROKER"  ? "Key Operative"
    : d.role === "EXECUTOR" ? "Field Executor"
    : d.role || "Entity";

  const scorePercent = Math.min(100, Math.round(d.kingpinScore));

  return (
    <div
      className={`group relative overflow-hidden rounded-xl border ${theme.border} bg-[#0d1424] transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl ${hTheme.glow}`}
      style={{ minWidth: 210, maxWidth: 240 }}
    >
      {/* Flowchart header stripe */}
      <div className={`${hTheme.header} flex items-center gap-2.5 px-3.5 py-2.5`}>
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/15 text-base shadow-inner">{icon}</span>
        <span className="truncate text-[13px] font-black tracking-tight text-white" style={{ maxWidth: 160 }}>{d.label}</span>
      </div>

      {/* Handles — all 4 sides */}
      <Handle type="target" position={Position.Top}    id="top-target"    className={`!h-2.5 !w-2.5 !border-2 !border-slate-950 ${hTheme.handleColor}`} />
      <Handle type="source" position={Position.Top}    id="top-source"    className={`!h-2.5 !w-2.5 !border-2 !border-slate-950 ${hTheme.handleColor}`} />
      <Handle type="target" position={Position.Bottom} id="bottom-target" className={`!h-2.5 !w-2.5 !border-2 !border-slate-950 ${hTheme.handleColor}`} />
      <Handle type="source" position={Position.Bottom} id="bottom-source" className={`!h-2.5 !w-2.5 !border-2 !border-slate-950 ${hTheme.handleColor}`} />
      <Handle type="target" position={Position.Left}   id="left-target"   className={`!h-2.5 !w-2.5 !border-2 !border-slate-950 ${hTheme.handleColor}`} />
      <Handle type="source" position={Position.Left}   id="left-source"   className={`!h-2.5 !w-2.5 !border-2 !border-slate-950 ${hTheme.handleColor}`} />
      <Handle type="target" position={Position.Right}  id="right-target"  className={`!h-2.5 !w-2.5 !border-2 !border-slate-950 ${hTheme.handleColor}`} />
      <Handle type="source" position={Position.Right}  id="right-source"  className={`!h-2.5 !w-2.5 !border-2 !border-slate-950 ${hTheme.handleColor}`} />

      {/* Body */}
      <div className="px-3.5 pb-3 pt-2.5 flex flex-col gap-2">
        {/* Role chip */}
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full animate-pulse ${hTheme.dot}`} />
          <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">{roleLabel}</span>
        </div>

        {/* Score bar (only for persons) */}
        {isPerson && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px]">
              <span className="font-semibold text-slate-500">Threat Score</span>
              <span className={`font-black ${scorePercent >= 60 ? "text-red-400" : scorePercent >= 35 ? "text-amber-400" : "text-emerald-400"}`}>{scorePercent}</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-slate-800">
              <div
                className={`h-1.5 rounded-full transition-all ${hTheme.score}`}
                style={{ width: `${scorePercent}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const nodeTypes: NodeTypes = { entity: EntityNode };

function ExplainableEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
}: EdgeProps) {
  const edge = data?.edge as NetworkEdge | undefined;
  const staggerIndex = (data?.staggerIndex as number) || 0;
  const arcDirection = (data?.arcDirection as "up" | "down" | "none") || "none";

  const isHypothesis = edge?.evidence?.includes("ghost link") || edge?.shortExplanation?.includes("Ghost Link") || edge?.shortExplanation?.includes("Hypothesis");
  const rel = edge?.relationType || "associate";

  // Edge color palette
  const edgeColor =
    rel === "financial_transfer" ? "#f87171"
    : rel === "phone_call"       ? "#60a5fa"
    : rel === "co_location"      ? "#fbbf24"
    : rel === "same_organization"? "#a78bfa"
    : rel === "family"           ? "#34d399"
    : isHypothesis               ? "#c084fc"
    : "#94a3b8";

  let edgePath = "";
  let labelX = (sourceX + targetX) / 2;
  let labelY = (sourceY + targetY) / 2;

  if (arcDirection === "up" || arcDirection === "down") {
    // Gentle arch curve — kept short so labels stay close to the graph
    const dir = arcDirection === "up" ? -1 : 1;
    const dx = Math.abs(targetX - sourceX);
    const archHeight = Math.max(60, Math.min(160, dx * 0.18)) + staggerIndex * 20;
    const controlY = Math.min(sourceY, targetY) + dir * archHeight;
    const midX = (sourceX + targetX) / 2;

    edgePath = `M ${sourceX} ${sourceY} Q ${midX} ${controlY} ${targetX} ${targetY}`;
    // Place label at the midpoint of the curve (t=0.5 on quadratic bezier)
    labelX = midX;
    labelY = (sourceY + 2 * controlY + targetY) / 4;
  } else {
    // Standard Bezier path
    const [path] = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    });
    edgePath = path;

    const dx = targetX - sourceX;
    const dy = targetY - sourceY;
    const len = Math.hypot(dx, dy) || 1;
    const px = -dy / len;
    const py = dx / len;

    // Stagger longitudinal t along line
    const tValues = [0.38, 0.62, 0.25, 0.75, 0.20, 0.80, 0.50];
    const t = tValues[staggerIndex % tValues.length] ?? 0.5;

    // Alternate perpendicular offset magnitude
    const offsetMagnitude = (staggerIndex === 0 ? 0 : (staggerIndex % 2 === 1 ? 1 : -1) * Math.ceil(staggerIndex / 2)) * 75;

    labelX = sourceX + dx * t + px * offsetMagnitude;
    labelY = sourceY + dy * t + py * offsetMagnitude;
  }

  // Always use a concise keyword label — never show raw shortExplanation in the badge
  const label =
    isHypothesis                   ? "Ghost Link"
    : rel === "financial_transfer" ? "Hawala"
    : rel === "phone_call"         ? "CDR Call"
    : rel === "co_location"        ? "Co-Location"
    : rel === "same_organization"  ? "Syndicate"
    : rel === "family"             ? "Family"
    : "Associate";

  const icon =
    rel === "financial_transfer" ? "💸"
    : rel === "phone_call"       ? "📞"
    : rel === "co_location"      ? "📍"
    : rel === "same_organization"? "🏢"
    : rel === "family"           ? "👨‍👩‍👧"
    : isHypothesis               ? "👻"
    : "🤝";

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: "all",
          }}
          className="nodrag nopan z-10"
        >
          <div className="group relative flex justify-center">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                const onEdgeClickCb = data?.onEdgeClick as ((edge: NetworkEdge) => void) | undefined;
                if (onEdgeClickCb && edge) {
                  onEdgeClickCb(edge);
                }
              }}
              className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-bold shadow-lg transition-all duration-150 hover:scale-105 active:scale-95 cursor-pointer backdrop-blur-md ${
                isHypothesis
                  ? "border-violet-500/70 bg-[#1a0f2e]/90 text-violet-300 shadow-[0_0_10px_rgba(168,85,247,0.4)]"
                  : rel === "financial_transfer"
                    ? "border-red-500/60 bg-[#1a0a0a]/90 text-red-300"
                    : rel === "phone_call"
                      ? "border-blue-500/60 bg-[#0a0f1a]/90 text-blue-300"
                      : rel === "co_location"
                        ? "border-amber-500/60 bg-[#1a150a]/90 text-amber-300"
                        : rel === "same_organization"
                          ? "border-purple-500/60 bg-[#130a1a]/90 text-purple-300"
                          : rel === "family"
                            ? "border-emerald-500/60 bg-[#0a1a12]/90 text-emerald-300"
                            : "border-slate-600/60 bg-[#0d1117]/90 text-slate-300"
              }`}
              style={{ borderColor: `${edgeColor}66` }}
            >
              <span className="text-[11px] leading-none">{icon}</span>
              <span className="whitespace-nowrap leading-none">{label}</span>
            </button>

            {/* Quick Hover Tooltip */}
            <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-64 -translate-x-1/2 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              <div className="relative rounded-lg border border-slate-700/80 bg-[#0d1424]/98 p-3 text-xs text-slate-200 shadow-2xl backdrop-blur-md">
                <div className="mb-1.5 flex items-center gap-1.5 border-b border-slate-700/50 pb-1.5">
                  <span style={{ color: edgeColor }}>{icon}</span>
                  <span className="font-bold text-white">{isHypothesis ? "AI Ghost Link" : "Case Evidence"}</span>
                </div>
                <div className="line-clamp-3 text-slate-300 leading-snug">
                  {edge?.shortExplanation || edge?.evidence || "Click for detailed case storyline and full evidence report."}
                </div>
                <div className="mt-2 text-[10px] font-bold" style={{ color: edgeColor }}>Click to view full intel report →</div>
                {/* Arrow */}
                <div className="absolute -bottom-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-b border-r border-slate-700/80 bg-[#0d1424]/98" />
              </div>
            </div>
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const edgeTypes: EdgeTypes = { explainable: ExplainableEdge };

export interface GraphClick {
  node: NetworkNode | null;
}

export function CriminalNetworkGraph({
  nodes,
  edges,
  onNodeClick,
  onEdgeClick,
}: {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  onNodeClick?: (node: NetworkNode) => void;
  onEdgeClick?: (edge: NetworkEdge) => void;
}) {
  const [showDirectLinks, setShowDirectLinks] = useState(true);
  const [showGhostLinks, setShowGhostLinks] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLegendExpanded, setIsLegendExpanded] = useState(true);
  const [internalSelectedEdge, setInternalSelectedEdge] = useState<NetworkEdge | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleEdgeClickInternal = useCallback(
    (edge: NetworkEdge) => {
      if (onEdgeClick) {
        onEdgeClick(edge);
      } else {
        setInternalSelectedEdge(edge);
      }
    },
    [onEdgeClick]
  );

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {
        setIsFullscreen(true);
      });
    } else {
      document.exitFullscreen().catch(() => {
        setIsFullscreen(false);
      });
    }
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFS = !!document.fullscreenElement;
      setIsFullscreen(isFS);
      // Force ReactFlow to re-measure canvas size when entering/exiting fullscreen
      setTimeout(() => {
        window.dispatchEvent(new Event("resize"));
      }, 50);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  // Flow-Wise Case Hierarchy Layout with Sub-Tier Alternating Y-Offsets and Position Map
  const { flowNodes, posMap } = useMemo(() => {
    const kingpins = nodes.filter((n) => n.role === "KINGPIN");
    const brokers = nodes.filter((n) => n.role === "BROKER");
    const executors = nodes.filter((n) => n.role === "EXECUTOR");
    const others = nodes.filter((n) => !["KINGPIN", "BROKER", "EXECUTOR"].includes(n.role));

    const computePositions = (itemList: NetworkNode[], baseGroupY: number): [string, XYPosition][] => {
      const count = itemList.length;
      if (count === 0) return [];
      // Tighter X spacing for a portrait/vertical layout — max 380px per column
      const spacingX = Math.max(300, Math.min(380, 1400 / (count + 1)));
      const startX = 700 - ((count - 1) * spacingX) / 2;
      return itemList.map((item, idx) => {
        // Alternate Y offset (+180px on odd indices) to avoid straight-line collision
        const yOffset = (idx % 2 === 1) ? 180 : 0;
        return [item.id, { x: startX + idx * spacingX, y: baseGroupY + yOffset }];
      });
    };

    const positionEntries: [string, XYPosition][] = [
      ...computePositions(kingpins, 80),
      ...computePositions(brokers, 400),
      ...computePositions(executors, 760),
      ...computePositions(others, 1120),
    ];

    const map = new Map<string, XYPosition>(positionEntries);

    const fNodes = nodes.map((n, i): Node => {
      const tierPos: XYPosition = map.get(n.id) || {
        x: 140 + (i % 4) * 460,
        y: 120 + Math.floor(i / 4) * 340,
      };

      return {
        id: n.id,
        type: "entity",
        position: tierPos,
        data: { label: n.label, role: n.role, kingpinScore: n.kingpinScore, node: n },
      };
    });

    return { flowNodes: fNodes, posMap: map };
  }, [nodes]);

  // Compute staggered offsets & dynamic handle selection for edges between nodes
  const flowEdges: Edge[] = useMemo(() => {
    const edgePairCounts = new Map<string, number>();

    const filteredEdges = edges.filter((e) => {
      const isGhost = e.evidence?.includes("ghost link") || e.shortExplanation?.includes("Ghost Link") || e.shortExplanation?.includes("Hypothesis");
      if (isGhost && !showGhostLinks) return false;
      if (!isGhost && !showDirectLinks) return false;
      return true;
    });

    return filteredEdges.map((e) => {
      const srcPos = posMap.get(e.sourceId);
      const tgtPos = posMap.get(e.targetId);

      const isHypothesis = e.evidence?.includes("ghost link") || e.shortExplanation?.includes("Ghost Link") || e.shortExplanation?.includes("Hypothesis");
      const isFinancialTransfer = e.relationType === "financial_transfer";

      const pairKey = [e.sourceId, e.targetId].sort().join("<->");
      const currentIdx = edgePairCounts.get(pairKey) || 0;
      edgePairCounts.set(pairKey, currentIdx + 1);

      let sourceHandle = "bottom-source";
      let targetHandle = "top-target";
      let arcDirection: "up" | "down" | "none" = "none";

      if (srcPos && tgtPos) {
        const dx = tgtPos.x - srcPos.x;
        const dy = tgtPos.y - srcPos.y;
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);

        if (absDy < 260 && absDx > 0) {
          // Same horizontal tier or adjacent sub-tier
          if (absDx >= 500) {
            // Multi-hop long-range edge spanning multiple columns!
            if (srcPos.y <= 550) {
              sourceHandle = "top-source";
              targetHandle = "top-target";
              arcDirection = "up";
            } else {
              sourceHandle = "bottom-source";
              targetHandle = "bottom-target";
              arcDirection = "down";
            }
          } else {
            // Neighboring nodes
            if (dx > 0) {
              sourceHandle = "right-source";
              targetHandle = "left-target";
            } else {
              sourceHandle = "left-source";
              targetHandle = "right-target";
            }
          }
        } else if (dy > 0) {
          // Source above Target
          sourceHandle = "bottom-source";
          targetHandle = "top-target";
        } else {
          // Target above Source
          sourceHandle = "top-source";
          targetHandle = "bottom-target";
        }
      }

      return {
        id: e.id,
        source: e.sourceId,
        target: e.targetId,
        sourceHandle,
        targetHandle,
        type: "explainable",
        data: {
          edge: e,
          onEdgeClick: handleEdgeClickInternal,
          staggerIndex: currentIdx,
          arcDirection,
        },
        animated: isFinancialTransfer || isHypothesis,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isFinancialTransfer ? "#f87171" : isHypothesis ? "#c084fc" : "#94a3b8",
          width: 18,
          height: 18,
        },
        style: {
          stroke: isFinancialTransfer ? "#f87171" : isHypothesis ? "#c084fc" : "#94a3b8",
          strokeWidth: isHypothesis ? 2 : Math.max(1.5, Math.min(3, 1 + e.weight)),
          strokeDasharray: isHypothesis ? "6 4" : undefined,
          filter: isHypothesis ? "drop-shadow(0 0 5px rgba(192,132,252,0.7))" : undefined,
          opacity: 0.85,
        },
      };
    });
  }, [edges, posMap, handleEdgeClickInternal, showDirectLinks, showGhostLinks]);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const meta = node.data as unknown as EntityNodeData;
      if (meta.node && onNodeClick) onNodeClick(meta.node);
    },
    [onNodeClick]
  );

  return (
    <div
      ref={containerRef}
      className={`relative w-full bg-[#060b14] shadow-2xl overflow-hidden transition-all duration-300 ${
        isFullscreen
          ? "fixed inset-0 z-[9999] h-screen w-screen"
          : "h-[920px] min-h-[88vh] rounded-2xl border border-slate-800/60"
      }`}
    >
      {/* Fullscreen toggle */}
      <button
        type="button"
        onClick={toggleFullscreen}
        title={isFullscreen ? "Exit fullscreen (Esc)" : "Expand to fullscreen"}
        className="absolute top-4 right-4 z-30 flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700/60 bg-slate-900/90 text-slate-300 shadow-lg backdrop-blur-md transition-all hover:bg-slate-800 hover:text-white hover:scale-110 active:scale-95"
      >
        {isFullscreen ? (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <path d="M8 3v3a2 2 0 0 1-2 2H3" /><path d="M21 8h-3a2 2 0 0 1-2-2V3" />
            <path d="M3 16h3a2 2 0 0 1 2 2v3" /><path d="M16 21v-3a2 2 0 0 1 2-2h3" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <path d="M3 7V3h4" /><path d="M21 7V3h-4" />
            <path d="M3 17v4h4" /><path d="M21 17v4h-4" />
          </svg>
        )}
      </button>

      {/* Top-Left Dark Legend & Controls Panel (Minimizable / Maximizable Dropdown) */}
      {!isLegendExpanded ? (
        <div
          onClick={() => setIsLegendExpanded(true)}
          className="absolute top-4 left-4 z-20 flex items-center justify-between gap-3 rounded-2xl border border-slate-700/80 bg-slate-900/95 px-4 py-2.5 text-xs font-bold text-slate-200 shadow-2xl backdrop-blur-md cursor-pointer hover:bg-slate-800/90 hover:border-slate-600 transition-all select-none group min-w-[200px]"
          title="Click to expand Legend & Filters"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm">🧭</span>
            <span className="font-extrabold tracking-wide">Legend & Filters</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold text-slate-400 group-hover:text-slate-200">Expand</span>
            <div className="flex h-5 w-5 items-center justify-center rounded-md bg-slate-800/80 text-slate-400 group-hover:bg-indigo-600 group-hover:text-white transition-all">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </div>
          </div>
        </div>
      ) : (
        <div className="absolute top-4 left-4 z-20 flex flex-col gap-3 rounded-2xl border border-slate-700/80 bg-slate-900/95 px-5 py-4 text-xs shadow-2xl backdrop-blur-md text-slate-200 min-w-[280px] max-w-[320px] transition-all duration-200">
          {/* Header & Minimize Toggle */}
          <div
            className="flex items-center justify-between border-b border-slate-700/50 pb-2.5 cursor-pointer select-none group"
            onClick={() => setIsLegendExpanded(false)}
            title="Click to minimize legend"
          >
            <div className="flex items-center gap-2 font-black text-slate-200 text-xs tracking-wider uppercase">
              <span>🧭</span> Legend & Controls
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsLegendExpanded(false);
              }}
              className="flex h-6 w-6 items-center justify-center rounded-lg bg-slate-800/80 text-slate-400 hover:bg-slate-700 hover:text-white transition-all"
              title="Minimize legend"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                <path d="m18 15-6-6-6 6" />
              </svg>
            </button>
          </div>

          {/* Node Types Legend */}
          <div className="flex flex-col gap-2 border-b border-slate-700/50 pb-3">
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Entity Roles</div>
            <div className="flex flex-wrap items-center gap-3.5">
              <div className="flex items-center gap-2 text-red-400 font-black">
                <span className="h-3 w-3 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]" /> 👑 Mastermind
              </div>
              <div className="flex items-center gap-2 text-amber-400 font-black">
                <span className="h-3 w-3 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)]" /> 💼 Key Operative
              </div>
              <div className="flex items-center gap-2 text-emerald-400 font-black">
                <span className="h-3 w-3 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" /> ⚡ Executor
              </div>
            </div>
          </div>

          {/* Edge Types Legend */}
          <div className="flex flex-col gap-2 border-b border-slate-700/50 pb-3">
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Link Types</div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <div className="h-0.5 w-6 bg-slate-400" />
                <span className="font-semibold text-slate-300">Direct FIR Link (Solid Evidence)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex gap-[2px]">
                  <div className="h-0.5 w-[4px] bg-violet-400 shadow-[0_0_5px_rgba(168,85,247,0.8)]" />
                  <div className="h-0.5 w-[4px] bg-violet-400 shadow-[0_0_5px_rgba(168,85,247,0.8)]" />
                  <div className="h-0.5 w-[4px] bg-violet-400 shadow-[0_0_5px_rgba(168,85,247,0.8)]" />
                  <div className="h-0.5 w-[4px] bg-violet-400 shadow-[0_0_5px_rgba(168,85,247,0.8)]" />
                </div>
                <span className="font-semibold text-violet-300">👻 Predicted Ghost Link (AI Hypothesis)</span>
              </div>
            </div>
          </div>

          <div className="text-slate-300 font-semibold flex items-center gap-1.5 pt-1">
            🔍 <span className="font-black text-amber-400">Click any relationship badge</span> to inspect detailed case storyline
          </div>

          {/* Link Visibility Toggles */}
          <div className="flex flex-col gap-2 border-t border-slate-700/50 pt-3 mt-1">
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Visibility Filters</div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer group">
                <div className={`relative flex h-5 w-9 items-center rounded-full transition-colors duration-200 ${showDirectLinks ? "bg-indigo-500" : "bg-slate-700"}`}>
                  <div className={`absolute left-1 h-3 w-3 rounded-full bg-white transition-transform duration-200 ${showDirectLinks ? "translate-x-4" : "translate-x-0"}`} />
                </div>
                <input type="checkbox" className="sr-only" checked={showDirectLinks} onChange={(e) => setShowDirectLinks(e.target.checked)} />
                <span className={`text-xs font-bold transition-colors ${showDirectLinks ? "text-slate-200" : "text-slate-500 group-hover:text-slate-400"}`}>Direct Links</span>
              </label>
              
              <label className="flex items-center gap-2 cursor-pointer group">
                <div className={`relative flex h-5 w-9 items-center rounded-full transition-colors duration-200 ${showGhostLinks ? "bg-violet-500 shadow-[0_0_8px_rgba(139,92,246,0.6)]" : "bg-slate-700"}`}>
                  <div className={`absolute left-1 h-3 w-3 rounded-full bg-white transition-transform duration-200 ${showGhostLinks ? "translate-x-4" : "translate-x-0"}`} />
                </div>
                <input type="checkbox" className="sr-only" checked={showGhostLinks} onChange={(e) => setShowGhostLinks(e.target.checked)} />
                <span className={`text-xs font-bold transition-colors ${showGhostLinks ? "text-violet-300" : "text-slate-500 group-hover:text-slate-400"}`}>Ghost Links</span>
              </label>
            </div>
          </div>
        </div>
      )}

      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={handleNodeClick}
        fitView
        fitViewOptions={{ padding: 0.35 }}
        minZoom={0.08}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={28} color="#1e293b" variant={BackgroundVariant.Lines} />
        {/* Controls shifted left of fullscreen button */}
        <Controls className="!top-4 !right-14 !left-auto !bg-[#0d1424] !border-slate-700/60 !text-slate-300 !rounded-xl shadow-xl" />
        <MiniMap
          nodeColor={(n) => {
            const r = (n.data as unknown as EntityNodeData).role ?? "default";
            return r === "KINGPIN" ? "#ef4444" : r === "BROKER" ? "#f59e0b" : r === "EXECUTOR" ? "#10b981" : "#6366f1";
          }}
          maskColor="rgba(6,11,20,0.75)"
          className="!bottom-4 !right-4 !bg-[#0d1424] !border-slate-700/60 !rounded-xl shadow-xl"
        />
      </ReactFlow>

      {/* Internal Fallback Storyline Inspection Modal (used when parent does not supply custom onEdgeClick) */}
      <Dialog open={!!internalSelectedEdge} onOpenChange={(open) => !open && setInternalSelectedEdge(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl p-6.5 shadow-2xl border border-slate-800 bg-[#0b101d] text-slate-100 backdrop-blur-xl">
          <DialogHeader className="border-b border-slate-800 pb-3.5">
            <DialogTitle className="flex items-center justify-between gap-2.5 text-xl font-black text-white">
              <div className="flex items-center gap-2.5">
                <span className="text-2xl">🕵️‍♂️</span> Executive Investigation Connection Storyline
              </div>
              {internalSelectedEdge && (
                <Badge variant="outline" className="border-amber-500/60 bg-amber-950/80 text-amber-300 font-mono text-xs px-2.5 py-1">
                  AI Confidence: {Math.round(internalSelectedEdge.weight * 100)}%
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          {internalSelectedEdge && (() => {
            const srcNode = nodes.find((n) => n.id === internalSelectedEdge.sourceId);
            const tgtNode = nodes.find((n) => n.id === internalSelectedEdge.targetId);
            const srcName = srcNode?.label || internalSelectedEdge.sourceId;
            const tgtName = tgtNode?.label || internalSelectedEdge.targetId;
            const isHypothesis = internalSelectedEdge.evidence?.includes("ghost link") || internalSelectedEdge.shortExplanation?.includes("Ghost Link") || internalSelectedEdge.shortExplanation?.includes("Hypothesis");
            const rel = internalSelectedEdge.relationType || "associate";

            return (
              <div className="space-y-4 text-sm mt-2">
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl">
                  <div className="flex flex-col items-center text-center p-3 rounded-xl bg-slate-950 border border-slate-800 shadow-md">
                    <span className="font-black text-white text-base max-w-[170px] truncate">{srcName}</span>
                    <div className="mt-1 flex items-center gap-1">
                      <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-300">{srcNode?.role || "ENTITY"}</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-center px-2">
                    <div className="flex items-center justify-center h-10 w-10 rounded-full bg-indigo-950 border border-indigo-500/50 text-indigo-300 font-extrabold text-lg shadow-lg">
                      ↔
                    </div>
                    <span className="mt-1 text-[10px] font-mono font-bold text-indigo-300 bg-indigo-950/90 px-2 py-0.5 rounded-full border border-indigo-800">
                      {(internalSelectedEdge.weight * 100).toFixed(0)}% Link
                    </span>
                  </div>
                  <div className="flex flex-col items-center text-center p-3 rounded-xl bg-slate-950 border border-slate-800 shadow-md">
                    <span className="font-black text-white text-base max-w-[170px] truncate">{tgtName}</span>
                    <div className="mt-1 flex items-center gap-1">
                      <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-300">{tgtNode?.role || "ENTITY"}</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-2">
                    <span>📖</span> Investigation Background & Case Storyline Breakdown
                  </div>
                  <div className="rounded-2xl bg-slate-950 p-5 text-xs text-slate-200 leading-relaxed font-normal shadow-2xl border border-slate-800 whitespace-pre-line">
                    {internalSelectedEdge.elaboration || internalSelectedEdge.shortExplanation || internalSelectedEdge.evidence || "Case storyline intelligence report."}
                  </div>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

