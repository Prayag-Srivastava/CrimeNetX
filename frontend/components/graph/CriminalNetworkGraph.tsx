"use client";

/**
 * CriminalNetworkGraph — SAKSHYA-compliant Interactive Crime Storyline Graph
 *
 * Merged features:
 * - SAKSHYA Three-Ink edge classification:
 *     SOLID BLACK  = Observed
 *     DASHED BLUE  = Predicted
 *     DOTTED ORANGE = Hypothesised
 * - Neo4j-compatible NetworkNode / NetworkEdge contracts
 * - Rich dark intelligence UI
 * - Four-way source/target handles
 * - Smart handle selection based on node positions
 * - Staggered edge labels for dense graphs
 * - Curved long-range edges
 * - Ghost-link visibility filter
 * - Direct-link visibility filter
 * - Explainable relationship badges
 * - Hover evidence tooltips
 * - Clickable edge storyline inspection
 * - Fullscreen mode
 * - Collapsible legend
 * - Threat scores for key roles
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";


// -----------------------------------------------------------------------------
// THEMES
// -----------------------------------------------------------------------------

const DEFAULT_THEME = {
  border:
    "border-indigo-500/80 shadow-[0_0_20px_rgba(99,102,241,0.35)]",
  bg: "bg-indigo-500",
  badgeBg:
    "bg-indigo-950/80 text-indigo-200 border-indigo-500/50",
  text: "text-indigo-300",
  label: "🏷️ Case Entity",
};

const ROLE_THEME: Record<string, typeof DEFAULT_THEME> = {
  KINGPIN: {
    border: "border-red-500",
    bg: "bg-red-500",
    badgeBg:
      "bg-red-950/90 text-red-200 border-red-500/60",
    text: "text-red-400",
    label: "👑 Mastermind / Kingpin",
  },

  BROKER: {
    border: "border-amber-500",
    bg: "bg-amber-500",
    badgeBg:
      "bg-amber-950/90 text-amber-200 border-amber-500/60",
    text: "text-amber-400",
    label: "💼 Key Operative / Broker",
  },

  EXECUTOR: {
    border: "border-emerald-500",
    bg: "bg-emerald-500",
    badgeBg:
      "bg-emerald-950/90 text-emerald-200 border-emerald-500/60",
    text: "text-emerald-400",
    label: "⚡ Field Executor",
  },

  default: DEFAULT_THEME,
};

const ROLE_HEADER_COLORS: Record<
  string,
  {
    header: string;
    glow: string;
    dot: string;
    score: string;
    handleColor: string;
  }
> = {
  KINGPIN: {
    header: "bg-gradient-to-r from-red-700 to-red-900",
    glow: "shadow-[0_0_28px_rgba(239,68,68,0.5)]",
    dot: "bg-red-400",
    score: "bg-red-500",
    handleColor: "!bg-red-400",
  },

  BROKER: {
    header: "bg-gradient-to-r from-amber-600 to-amber-900",
    glow: "shadow-[0_0_28px_rgba(245,158,11,0.5)]",
    dot: "bg-amber-400",
    score: "bg-amber-500",
    handleColor: "!bg-amber-400",
  },

  EXECUTOR: {
    header: "bg-gradient-to-r from-emerald-700 to-emerald-900",
    glow: "shadow-[0_0_28px_rgba(16,185,129,0.5)]",
    dot: "bg-emerald-400",
    score: "bg-emerald-500",
    handleColor: "!bg-emerald-400",
  },

  default: {
    header: "bg-gradient-to-r from-indigo-700 to-indigo-900",
    glow: "shadow-[0_0_28px_rgba(99,102,241,0.4)]",
    dot: "bg-indigo-400",
    score: "bg-indigo-500",
    handleColor: "!bg-indigo-400",
  },
};


// -----------------------------------------------------------------------------
// TYPES
// -----------------------------------------------------------------------------

interface EntityNodeData {
  label: string;
  role: string;
  kingpinScore: number;
  node?: NetworkNode;
}

type InkType = "observed" | "predicted" | "hypothesised";


// -----------------------------------------------------------------------------
// SAKSHYA THREE-INK CLASSIFICATION
// -----------------------------------------------------------------------------

function classifyEdge(edge: NetworkEdge): InkType {
  const evidence = (edge.evidence || "").toLowerCase();
  const explanation = (edge.shortExplanation || "").toLowerCase();

  // Hypothesised:
  // Investigator has explicitly accepted a ghost/hypothesis link.
  if (
    evidence.includes("investigator-accepted") ||
    evidence.includes("ghost link") ||
    explanation.includes("ghost link") ||
    explanation.includes("hypothesis")
  ) {
    return "hypothesised";
  }

  // Observed:
  // Structured / directly observed evidence.
  if (
    evidence.includes("cdr row") ||
    evidence.includes("inr @") ||
    evidence.includes("duration:") ||
    edge.relationType === "phone_call" ||
    edge.relationType === "financial_transfer"
  ) {
    return "observed";
  }

  // Everything else is an AI/text-derived relationship.
  return "predicted";
}

const EDGE_STYLES: Record<
  InkType,
  {
    stroke: string;
    strokeWidth: number;
    strokeDasharray?: string;
    labelColor: string;
    labelBg: string;
    badgeClass: string;
  }
> = {
  observed: {
    stroke: "#111827",
    strokeWidth: 2.5,
    strokeDasharray: undefined,
    labelColor: "#e5e7eb",
    labelBg: "#111827",
    badgeClass:
      "border-slate-600/80 bg-[#111827]/95 text-slate-100",
  },

  predicted: {
    stroke: "#2563eb",
    strokeWidth: 1.8,
    strokeDasharray: "6 3",
    labelColor: "#93c5fd",
    labelBg: "#0b1733",
    badgeClass:
      "border-blue-500/60 bg-[#0b1733]/95 text-blue-300",
  },

  hypothesised: {
    stroke: "#ea580c",
    strokeWidth: 1.8,
    strokeDasharray: "2 4",
    labelColor: "#fdba74",
    labelBg: "#2a1609",
    badgeClass:
      "border-orange-500/70 bg-[#2a1609]/95 text-orange-300",
  },
};


// -----------------------------------------------------------------------------
// ENTITY NODE
// -----------------------------------------------------------------------------

function EntityNode({ data }: NodeProps) {
  const d = data as unknown as EntityNodeData;

  const theme = ROLE_THEME[d.role] ?? DEFAULT_THEME;

  const hTheme =
    ROLE_HEADER_COLORS[d.role] ??
    ROLE_HEADER_COLORS.default;

  const isPerson =
    d.role === "KINGPIN" ||
    d.role === "BROKER" ||
    d.role === "EXECUTOR";

  const icon =
    d.role === "KINGPIN"
      ? "👑"
      : d.role === "BROKER"
        ? "💼"
        : d.role === "EXECUTOR"
          ? "⚡"
          : d.label.startsWith("98") ||
              d.label.startsWith("97") ||
              d.label.startsWith("99")
            ? "📱"
            : d.label.includes("MH-")
              ? "🚗"
              : d.label.includes("Police") ||
                  d.label.includes("Pune") ||
                  d.label.includes("Nashik")
                ? "📍"
                : d.label.match(/^\d{10,}$/)
                  ? "🏦"
                  : "🏷️";

  const roleLabel =
    d.role === "KINGPIN"
      ? "Command — Mastermind"
      : d.role === "BROKER"
        ? "Key Operative"
        : d.role === "EXECUTOR"
          ? "Field Executor"
          : d.role || "Entity";

  const scorePercent = Math.min(
    100,
    Math.max(0, Math.round(d.kingpinScore ?? 0))
  );

  return (
    <div
      className={`group relative overflow-hidden rounded-xl border ${theme.border} bg-[#0d1424] transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl ${hTheme.glow}`}
      style={{
        minWidth: 210,
        maxWidth: 240,
      }}
    >
      {/* Header */}
      <div
        className={`${hTheme.header} flex items-center gap-2.5 px-3.5 py-2.5`}
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/15 text-base shadow-inner">
          {icon}
        </span>

        <span
          className="truncate text-[13px] font-black tracking-tight text-white"
          style={{ maxWidth: 160 }}
        >
          {d.label}
        </span>
      </div>

      {/* Four-way target/source handles */}
      <Handle
        type="target"
        position={Position.Top}
        id="top-target"
        className={`!h-2.5 !w-2.5 !border-2 !border-slate-950 ${hTheme.handleColor}`}
      />

      <Handle
        type="source"
        position={Position.Top}
        id="top-source"
        className={`!h-2.5 !w-2.5 !border-2 !border-slate-950 ${hTheme.handleColor}`}
      />

      <Handle
        type="target"
        position={Position.Bottom}
        id="bottom-target"
        className={`!h-2.5 !w-2.5 !border-2 !border-slate-950 ${hTheme.handleColor}`}
      />

      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom-source"
        className={`!h-2.5 !w-2.5 !border-2 !border-slate-950 ${hTheme.handleColor}`}
      />

      <Handle
        type="target"
        position={Position.Left}
        id="left-target"
        className={`!h-2.5 !w-2.5 !border-2 !border-slate-950 ${hTheme.handleColor}`}
      />

      <Handle
        type="source"
        position={Position.Left}
        id="left-source"
        className={`!h-2.5 !w-2.5 !border-2 !border-slate-950 ${hTheme.handleColor}`}
      />

      <Handle
        type="target"
        position={Position.Right}
        id="right-target"
        className={`!h-2.5 !w-2.5 !border-2 !border-slate-950 ${hTheme.handleColor}`}
      />

      <Handle
        type="source"
        position={Position.Right}
        id="right-source"
        className={`!h-2.5 !w-2.5 !border-2 !border-slate-950 ${hTheme.handleColor}`}
      />

      {/* Body */}
      <div className="flex flex-col gap-2 px-3.5 pb-3 pt-2.5">
        <div className="flex items-center gap-1.5">
          <span
            className={`h-2 w-2 rounded-full animate-pulse ${hTheme.dot}`}
          />

          <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
            {roleLabel}
          </span>
        </div>

        {isPerson && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px]">
              <span className="font-semibold text-slate-500">
                Threat Score
              </span>

              <span
                className={`font-black ${
                  scorePercent >= 60
                    ? "text-red-400"
                    : scorePercent >= 35
                      ? "text-amber-400"
                      : "text-emerald-400"
                }`}
              >
                {scorePercent}
              </span>
            </div>

            <div className="h-1.5 w-full rounded-full bg-slate-800">
              <div
                className={`h-1.5 rounded-full transition-all ${hTheme.score}`}
                style={{
                  width: `${scorePercent}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const nodeTypes: NodeTypes = {
  entity: EntityNode,
};


// -----------------------------------------------------------------------------
// EXPLAINABLE EDGE
// -----------------------------------------------------------------------------

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

  const staggerIndex =
    (data?.staggerIndex as number) || 0;

  const arcDirection =
    (data?.arcDirection as "up" | "down" | "none") ||
    "none";

  const inkType: InkType = edge
    ? classifyEdge(edge)
    : "predicted";

  const inkStyle = EDGE_STYLES[inkType];

  const rel = edge?.relationType || "associate";

  const isHypothesis = inkType === "hypothesised";

  let edgePath = "";

  let labelX =
    (sourceX + targetX) / 2;

  let labelY =
    (sourceY + targetY) / 2;

  // ---------------------------------------------------------------------------
  // Long-range arch routing
  // ---------------------------------------------------------------------------

  if (
    arcDirection === "up" ||
    arcDirection === "down"
  ) {
    const dir =
      arcDirection === "up" ? -1 : 1;

    const dx = Math.abs(
      targetX - sourceX
    );

    const archHeight =
      Math.max(
        60,
        Math.min(160, dx * 0.18)
      ) +
      staggerIndex * 20;

    const controlY =
      Math.min(sourceY, targetY) +
      dir * archHeight;

    const midX =
      (sourceX + targetX) / 2;

    edgePath = `M ${sourceX} ${sourceY} Q ${midX} ${controlY} ${targetX} ${targetY}`;

    labelX = midX;

    labelY =
      (sourceY +
        2 * controlY +
        targetY) /
      4;
  } else {
    const [path] =
      getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
      });

    edgePath = path;

    const dx =
      targetX - sourceX;

    const dy =
      targetY - sourceY;

    const len =
      Math.hypot(dx, dy) || 1;

    const px = -dy / len;
    const py = dx / len;

    const tValues = [
      0.38,
      0.62,
      0.25,
      0.75,
      0.2,
      0.8,
      0.5,
    ];

    const t =
      tValues[
        staggerIndex %
          tValues.length
      ] ?? 0.5;

    const offsetMagnitude =
      staggerIndex === 0
        ? 0
        : (staggerIndex % 2 === 1
            ? 1
            : -1) *
          Math.ceil(
            staggerIndex / 2
          ) *
          75;

    labelX =
      sourceX +
      dx * t +
      px * offsetMagnitude;

    labelY =
      sourceY +
      dy * t +
      py * offsetMagnitude;
  }

  // ---------------------------------------------------------------------------
  // Human-readable relationship label
  // ---------------------------------------------------------------------------

  const label =
    isHypothesis
      ? "Ghost Link"
      : rel === "financial_transfer"
        ? "Hawala"
        : rel === "phone_call"
          ? "CDR Call"
          : rel === "co_location"
            ? "Co-Location"
            : rel === "same_organization"
              ? "Syndicate"
              : rel === "family"
                ? "Family"
                : rel === "co_accused"
                  ? "Co-Accused"
                  : rel === "victim_of"
                    ? "Victim Of"
                    : rel === "witness_to"
                      ? "Witness"
                      : "Associate";

  const icon =
    rel === "financial_transfer"
      ? "💸"
      : rel === "phone_call"
        ? "📞"
        : rel === "co_location"
          ? "📍"
          : rel === "same_organization"
            ? "🏢"
            : rel === "family"
              ? "👨‍👩‍👧"
              : isHypothesis
                ? "👻"
                : rel === "co_accused"
                  ? "⚖️"
                  : "🤝";

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: inkStyle.stroke,
          strokeWidth:
            style.strokeWidth ??
            inkStyle.strokeWidth,
          strokeDasharray:
            inkStyle.strokeDasharray,
        }}
      />

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
              onClick={(event) => {
                event.stopPropagation();

                const callback =
                  data?.onEdgeClick as
                    | ((
                        edge: NetworkEdge
                      ) => void)
                    | undefined;

                if (callback && edge) {
                  callback(edge);
                }
              }}
              className={`flex cursor-pointer items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-bold shadow-lg backdrop-blur-md transition-all duration-150 hover:scale-105 active:scale-95 ${inkStyle.badgeClass}`}
              style={{
                borderColor: `${inkStyle.stroke}99`,
              }}
            >
              <span className="text-[11px] leading-none">
                {icon}
              </span>

              <span className="whitespace-nowrap leading-none">
                {label}
              </span>
            </button>

            {/* Hover tooltip */}
            <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-72 -translate-x-1/2 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              <div className="relative rounded-lg border border-slate-700/80 bg-[#0d1424]/98 p-3 text-xs text-slate-200 shadow-2xl backdrop-blur-md">
                <div className="mb-1.5 flex items-center justify-between gap-2 border-b border-slate-700/50 pb-1.5">
                  <div className="flex items-center gap-1.5">
                    <span
                      style={{
                        color: inkStyle.stroke,
                      }}
                    >
                      {icon}
                    </span>

                    <span className="font-bold text-white">
                      {isHypothesis
                        ? "AI / Investigator Hypothesis"
                        : inkType === "observed"
                          ? "Observed Evidence"
                          : "AI Predicted Link"}
                    </span>
                  </div>

                  <span
                    className="rounded border px-1.5 py-0.5 text-[9px] font-black uppercase"
                    style={{
                      color:
                        inkStyle.labelColor,
                      borderColor: `${inkStyle.stroke}66`,
                    }}
                  >
                    {inkType}
                  </span>
                </div>

                <div className="line-clamp-4 leading-snug text-slate-300">
                  {edge?.shortExplanation ||
                    edge?.evidence ||
                    "Click for detailed case storyline and full evidence report."}
                </div>

                <div
                  className="mt-2 text-[10px] font-bold"
                  style={{
                    color:
                      inkStyle.labelColor,
                  }}
                >
                  Click to view full intel report →
                </div>

                <div
                  className="absolute -bottom-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-b border-r border-slate-700/80 bg-[#0d1424]/98"
                />
              </div>
            </div>
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const edgeTypes: EdgeTypes = {
  explainable: ExplainableEdge,
};


// -----------------------------------------------------------------------------
// GRAPH COMPONENT
// -----------------------------------------------------------------------------

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
  onNodeClick?: (
    node: NetworkNode
  ) => void;
  onEdgeClick?: (
    edge: NetworkEdge
  ) => void;
}) {
  const [
    showDirectLinks,
    setShowDirectLinks,
  ] = useState(true);

  const [
    showGhostLinks,
    setShowGhostLinks,
  ] = useState(true);

  const [
    isFullscreen,
    setIsFullscreen,
  ] = useState(false);

  const [
    isLegendExpanded,
    setIsLegendExpanded,
  ] = useState(true);

  const [
    internalSelectedEdge,
    setInternalSelectedEdge,
  ] =
    useState<NetworkEdge | null>(
      null
    );

  const containerRef =
    useRef<HTMLDivElement>(null);

  // ---------------------------------------------------------------------------
  // Edge click
  // ---------------------------------------------------------------------------

  const handleEdgeClickInternal =
    useCallback(
      (edge: NetworkEdge) => {
        if (onEdgeClick) {
          onEdgeClick(edge);
        } else {
          setInternalSelectedEdge(
            edge
          );
        }
      },
      [onEdgeClick]
    );

  // ---------------------------------------------------------------------------
  // Fullscreen
  // ---------------------------------------------------------------------------

  const toggleFullscreen =
    useCallback(() => {
      if (!containerRef.current) {
        return;
      }

      if (!document.fullscreenElement) {
        containerRef.current
          .requestFullscreen()
          .catch(() => {
            setIsFullscreen(true);
          });
      } else {
        document
          .exitFullscreen()
          .catch(() => {
            setIsFullscreen(false);
          });
      }
    }, []);

  useEffect(() => {
    const handleFullscreenChange =
      () => {
        const isFS =
          !!document.fullscreenElement;

        setIsFullscreen(isFS);

        setTimeout(() => {
          window.dispatchEvent(
            new Event("resize")
          );
        }, 50);
      };

    document.addEventListener(
      "fullscreenchange",
      handleFullscreenChange
    );

    return () => {
      document.removeEventListener(
        "fullscreenchange",
        handleFullscreenChange
      );
    };
  }, []);

  // ---------------------------------------------------------------------------
  // SAKSHYA edge counts
  // ---------------------------------------------------------------------------

  const edgeCounts = useMemo(() => {
    const counts: Record<
      InkType,
      number
    > = {
      observed: 0,
      predicted: 0,
      hypothesised: 0,
    };

    for (const edge of edges) {
      counts[classifyEdge(edge)]++;
    }

    return counts;
  }, [edges]);

  // ---------------------------------------------------------------------------
  // Hierarchical layout
  // ---------------------------------------------------------------------------

  const { flowNodes, posMap } =
    useMemo(() => {
      const kingpins =
        nodes.filter(
          (n) => n.role === "KINGPIN"
        );

      const brokers =
        nodes.filter(
          (n) => n.role === "BROKER"
        );

      const executors =
        nodes.filter(
          (n) => n.role === "EXECUTOR"
        );

      const others =
        nodes.filter(
          (n) =>
            ![
              "KINGPIN",
              "BROKER",
              "EXECUTOR",
            ].includes(n.role)
        );

      const computePositions = (
        itemList: NetworkNode[],
        baseGroupY: number
      ): [
        string,
        XYPosition
      ][] => {
        const count =
          itemList.length;

        if (count === 0) {
          return [];
        }

        const spacingX = Math.max(
          300,
          Math.min(
            380,
            1400 / (count + 1)
          )
        );

        const startX =
          700 -
          ((count - 1) *
            spacingX) /
            2;

        return itemList.map(
          (item, index) => {
            const yOffset =
              index % 2 === 1
                ? 180
                : 0;

            return [
              item.id,
              {
                x:
                  startX +
                  index *
                    spacingX,
                y:
                  baseGroupY +
                  yOffset,
              },
            ];
          }
        );
      };

      const positionEntries: [
        string,
        XYPosition
      ][] = [
        ...computePositions(
          kingpins,
          80
        ),
        ...computePositions(
          brokers,
          400
        ),
        ...computePositions(
          executors,
          760
        ),
        ...computePositions(
          others,
          1120
        ),
      ];

      const map =
        new Map<
          string,
          XYPosition
        >(positionEntries);

      const fNodes =
        nodes.map(
          (node, index): Node => {
            const tierPos =
              map.get(node.id) || {
                x:
                  140 +
                  (index % 4) *
                    460,
                y:
                  120 +
                  Math.floor(
                    index / 4
                  ) * 340,
              };

            return {
              id: node.id,
              type: "entity",
              position: tierPos,
              data: {
                label: node.label,
                role: node.role,
                kingpinScore:
                  node.kingpinScore,
                node,
              },
            };
          }
        );

      return {
        flowNodes: fNodes,
        posMap: map,
      };
    }, [nodes]);

  // ---------------------------------------------------------------------------
  // Edges
  // ---------------------------------------------------------------------------

  const flowEdges: Edge[] =
    useMemo(() => {
      const edgePairCounts =
        new Map<
          string,
          number
        >();

      const filteredEdges =
        edges.filter((edge) => {
          const inkType =
            classifyEdge(edge);

          const isGhost =
            inkType ===
            "hypothesised";

          if (
            isGhost &&
            !showGhostLinks
          ) {
            return false;
          }

          if (
            !isGhost &&
            !showDirectLinks
          ) {
            return false;
          }

          return true;
        });

      return filteredEdges.map(
        (edge) => {
          const srcPos =
            posMap.get(
              edge.sourceId
            );

          const tgtPos =
            posMap.get(
              edge.targetId
            );

          const inkType =
            classifyEdge(edge);

          const inkStyle =
            EDGE_STYLES[inkType];

          const isFinancial =
            edge.relationType ===
            "financial_transfer";

          const pairKey = [
            edge.sourceId,
            edge.targetId,
          ]
            .sort()
            .join("<->");

          const currentIdx =
            edgePairCounts.get(
              pairKey
            ) || 0;

          edgePairCounts.set(
            pairKey,
            currentIdx + 1
          );

          let sourceHandle =
            "bottom-source";

          let targetHandle =
            "top-target";

          let arcDirection:
            | "up"
            | "down"
            | "none" =
            "none";

          if (
            srcPos &&
            tgtPos
          ) {
            const dx =
              tgtPos.x -
              srcPos.x;

            const dy =
              tgtPos.y -
              srcPos.y;

            const absDx =
              Math.abs(dx);

            const absDy =
              Math.abs(dy);

            if (
              absDy < 260 &&
              absDx > 0
            ) {
              if (
                absDx >= 500
              ) {
                if (
                  srcPos.y <=
                  550
                ) {
                  sourceHandle =
                    "top-source";

                  targetHandle =
                    "top-target";

                  arcDirection =
                    "up";
                } else {
                  sourceHandle =
                    "bottom-source";

                  targetHandle =
                    "bottom-target";

                  arcDirection =
                    "down";
                }
              } else {
                if (dx > 0) {
                  sourceHandle =
                    "right-source";

                  targetHandle =
                    "left-target";
                } else {
                  sourceHandle =
                    "left-source";

                  targetHandle =
                    "right-target";
                }
              }
            } else if (
              dy > 0
            ) {
              sourceHandle =
                "bottom-source";

              targetHandle =
                "top-target";
            } else {
              sourceHandle =
                "top-source";

              targetHandle =
                "bottom-target";
            }
          }

          return {
            id: edge.id,
            source:
              edge.sourceId,
            target:
              edge.targetId,

            sourceHandle,
            targetHandle,

            type: "explainable",

            data: {
              edge,
              onEdgeClick:
                handleEdgeClickInternal,
              staggerIndex:
                currentIdx,
              arcDirection,
            },

            animated:
              isFinancial ||
              inkType ===
                "hypothesised",

            markerEnd: {
              type: MarkerType.ArrowClosed,
              color:
                inkStyle.stroke,
              width: 18,
              height: 18,
            },

            style: {
              stroke:
                inkStyle.stroke,

              strokeWidth:
                inkStyle.strokeWidth,

              strokeDasharray:
                inkStyle.strokeDasharray,

              opacity: 0.9,

              ...(inkType ===
                "hypothesised"
                ? {
                    filter:
                      "drop-shadow(0 0 5px rgba(234,88,12,0.65))",
                  }
                : {}),
            },
          };
        }
      );
    }, [
      edges,
      posMap,
      handleEdgeClickInternal,
      showDirectLinks,
      showGhostLinks,
    ]);

  // ---------------------------------------------------------------------------
  // Node click
  // ---------------------------------------------------------------------------

  const handleNodeClick =
    useCallback(
      (
        _event: React.MouseEvent,
        node: Node
      ) => {
        const meta =
          node.data as unknown as EntityNodeData;

        if (
          meta.node &&
          onNodeClick
        ) {
          onNodeClick(
            meta.node
          );
        }
      },
      [onNodeClick]
    );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      ref={containerRef}
      className={`relative w-full overflow-hidden bg-[#060b14] shadow-2xl transition-all duration-300 ${
        isFullscreen
          ? "fixed inset-0 z-[9999] h-screen w-screen"
          : "h-[920px] min-h-[88vh] rounded-2xl border border-slate-800/60"
      }`}
    >
      {/* ------------------------------------------------------------------ */}
      {/* FULLSCREEN */}
      {/* ------------------------------------------------------------------ */}

      <button
        type="button"
        onClick={
          toggleFullscreen
        }
        title={
          isFullscreen
            ? "Exit fullscreen (Esc)"
            : "Expand to fullscreen"
        }
        className="absolute right-4 top-4 z-30 flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700/60 bg-slate-900/90 text-slate-300 shadow-lg backdrop-blur-md transition-all hover:scale-110 hover:bg-slate-800 hover:text-white active:scale-95"
      >
        {isFullscreen ? (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
          >
            <path d="M8 3v3a2 2 0 0 1-2 2H3" />
            <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
            <path d="M3 16h3a2 2 0 0 1 2 2v3" />
            <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
          </svg>
        ) : (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
          >
            <path d="M3 7V3h4" />
            <path d="M21 7V3h-4" />
            <path d="M3 17v4h4" />
            <path d="M21 17v4h-4" />
          </svg>
        )}
      </button>

      {/* ------------------------------------------------------------------ */}
      {/* COLLAPSED LEGEND */}
      {/* ------------------------------------------------------------------ */}

      {!isLegendExpanded ? (
        <div
          onClick={() =>
            setIsLegendExpanded(
              true
            )
          }
          className="group absolute left-4 top-4 z-20 flex min-w-[210px] cursor-pointer items-center justify-between gap-3 rounded-2xl border border-slate-700/80 bg-slate-900/95 px-4 py-2.5 text-xs font-bold text-slate-200 shadow-2xl backdrop-blur-md transition-all hover:border-slate-600 hover:bg-slate-800/90 select-none"
          title="Click to expand Legend & Filters"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm">
              🧭
            </span>

            <span className="font-extrabold tracking-wide">
              Legend & Filters
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold text-slate-400 group-hover:text-slate-200">
              Expand
            </span>

            <div className="flex h-5 w-5 items-center justify-center rounded-md bg-slate-800/80 text-slate-400 transition-all group-hover:bg-indigo-600 group-hover:text-white">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-3.5 w-3.5"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </div>
          </div>
        </div>
      ) : (
        <div className="absolute left-4 top-4 z-20 flex min-w-[300px] max-w-[340px] flex-col gap-3 rounded-2xl border border-slate-700/80 bg-slate-900/95 px-5 py-4 text-xs text-slate-200 shadow-2xl backdrop-blur-md transition-all duration-200">
          {/* Header */}
          <div
            className="flex cursor-pointer select-none items-center justify-between border-b border-slate-700/50 pb-2.5 group"
            onClick={() =>
              setIsLegendExpanded(
                false
              )
            }
            title="Click to minimize legend"
          >
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-200">
              <span>🧭</span>
              Legend & Controls
            </div>

            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();

                setIsLegendExpanded(
                  false
                );
              }}
              className="flex h-6 w-6 items-center justify-center rounded-lg bg-slate-800/80 text-slate-400 transition-all hover:bg-slate-700 hover:text-white"
              title="Minimize legend"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-3.5 w-3.5"
              >
                <path d="m18 15-6-6-6 6" />
              </svg>
            </button>
          </div>

          {/* -------------------------------------------------------------- */}
          {/* ROLE LEGEND */}
          {/* -------------------------------------------------------------- */}

          <div className="flex flex-col gap-2 border-b border-slate-700/50 pb-3">
            <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">
              Entity Roles
            </div>

            <div className="flex flex-wrap items-center gap-3.5">
              <div className="flex items-center gap-2 font-black text-red-400">
                <span className="h-3 w-3 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
                👑 Mastermind
              </div>

              <div className="flex items-center gap-2 font-black text-amber-400">
                <span className="h-3 w-3 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)]" />
                💼 Key Operative
              </div>

              <div className="flex items-center gap-2 font-black text-emerald-400">
                <span className="h-3 w-3 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
                ⚡ Executor
              </div>
            </div>
          </div>

          {/* -------------------------------------------------------------- */}
          {/* SAKSHYA THREE-INK LEGEND */}
          {/* -------------------------------------------------------------- */}

          <div className="flex flex-col gap-2 border-b border-slate-700/50 pb-3">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                SAKSHYA Three-Ink Links
              </div>

              <div className="rounded bg-slate-800 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-slate-400">
                Evidence Provenance
              </div>
            </div>

            <div className="flex flex-col gap-2">
              {/* Observed */}
              <div className="flex items-center gap-2">
                <svg
                  width="28"
                  height="4"
                  aria-hidden="true"
                >
                  <line
                    x1="0"
                    y1="2"
                    x2="28"
                    y2="2"
                    stroke="#111827"
                    strokeWidth="2.5"
                  />
                </svg>

                <span className="font-semibold text-slate-200">
                  Observed ({edgeCounts.observed})
                </span>
              </div>

              {/* Predicted */}
              <div className="flex items-center gap-2">
                <svg
                  width="28"
                  height="4"
                  aria-hidden="true"
                >
                  <line
                    x1="0"
                    y1="2"
                    x2="28"
                    y2="2"
                    stroke="#2563eb"
                    strokeWidth="1.8"
                    strokeDasharray="6 3"
                  />
                </svg>

                <span className="font-semibold text-blue-300">
                  Predicted ({edgeCounts.predicted})
                </span>
              </div>

              {/* Hypothesised */}
              <div className="flex items-center gap-2">
                <svg
                  width="28"
                  height="4"
                  aria-hidden="true"
                >
                  <line
                    x1="0"
                    y1="2"
                    x2="28"
                    y2="2"
                    stroke="#ea580c"
                    strokeWidth="1.8"
                    strokeDasharray="2 4"
                  />
                </svg>

                <span className="font-semibold text-orange-300">
                  Hypothesised ({edgeCounts.hypothesised})
                </span>
              </div>
            </div>
          </div>

          {/* -------------------------------------------------------------- */}
          {/* EXPLANATION */}
          {/* -------------------------------------------------------------- */}

          <div className="text-slate-300 font-semibold flex items-center gap-1.5">
            🔍
            <span className="font-black text-amber-400">
              Click any relationship badge
            </span>
            to inspect detailed case storyline
          </div>

          {/* -------------------------------------------------------------- */}
          {/* FILTERS */}
          {/* -------------------------------------------------------------- */}

          <div className="mt-1 flex flex-col gap-2 border-t border-slate-700/50 pt-3">
            <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">
              Visibility Filters
            </div>

            <div className="flex flex-col gap-2.5">
              {/* Direct */}
              <label className="group flex cursor-pointer items-center gap-2">
                <div
                  className={`relative flex h-5 w-9 items-center rounded-full transition-colors duration-200 ${
                    showDirectLinks
                      ? "bg-indigo-500"
                      : "bg-slate-700"
                  }`}
                >
                  <div
                    className={`absolute left-1 h-3 w-3 rounded-full bg-white transition-transform duration-200 ${
                      showDirectLinks
                        ? "translate-x-4"
                        : "translate-x-0"
                    }`}
                  />
                </div>

                <input
                  type="checkbox"
                  className="sr-only"
                  checked={
                    showDirectLinks
                  }
                  onChange={(event) =>
                    setShowDirectLinks(
                      event.target
                        .checked
                    )
                  }
                />

                <span
                  className={`text-xs font-bold transition-colors ${
                    showDirectLinks
                      ? "text-slate-200"
                      : "text-slate-500 group-hover:text-slate-400"
                  }`}
                >
                  Observed / Predicted Links
                </span>
              </label>

              {/* Hypothesised */}
              <label className="group flex cursor-pointer items-center gap-2">
                <div
                  className={`relative flex h-5 w-9 items-center rounded-full transition-colors duration-200 ${
                    showGhostLinks
                      ? "bg-orange-500 shadow-[0_0_8px_rgba(234,88,12,0.6)]"
                      : "bg-slate-700"
                  }`}
                >
                  <div
                    className={`absolute left-1 h-3 w-3 rounded-full bg-white transition-transform duration-200 ${
                      showGhostLinks
                        ? "translate-x-4"
                        : "translate-x-0"
                    }`}
                  />
                </div>

                <input
                  type="checkbox"
                  className="sr-only"
                  checked={
                    showGhostLinks
                  }
                  onChange={(event) =>
                    setShowGhostLinks(
                      event.target
                        .checked
                    )
                  }
                />

                <span
                  className={`text-xs font-bold transition-colors ${
                    showGhostLinks
                      ? "text-orange-300"
                      : "text-slate-500 group-hover:text-slate-400"
                  }`}
                >
                  Hypothesised Ghost Links
                </span>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* REACT FLOW */}
      {/* ------------------------------------------------------------------ */}

      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={handleNodeClick}
        fitView
        fitViewOptions={{
          padding: 0.35,
        }}
        minZoom={0.08}
        proOptions={{
          hideAttribution: true,
        }}
      >
        <Background
          gap={28}
          color="#1e293b"
          variant={
            BackgroundVariant.Lines
          }
        />

        <Controls className="!left-auto !right-14 !top-4 !rounded-xl !border-slate-700/60 !bg-[#0d1424] !text-slate-300 shadow-xl" />

        <MiniMap
          nodeColor={(node) => {
            const role =
              (
                node.data as unknown as EntityNodeData
              ).role ?? "default";

            return role ===
              "KINGPIN"
              ? "#ef4444"
              : role === "BROKER"
                ? "#f59e0b"
                : role ===
                    "EXECUTOR"
                  ? "#10b981"
                  : "#6366f1";
          }}
          maskColor="rgba(6,11,20,0.75)"
          className="!bottom-4 !right-4 !rounded-xl !border-slate-700/60 !bg-[#0d1424] shadow-xl"
        />
      </ReactFlow>

      {/* ------------------------------------------------------------------ */}
      {/* INTERNAL STORYLINE MODAL */}
      {/* ------------------------------------------------------------------ */}

      <Dialog
        open={
          !!internalSelectedEdge
        }
        onOpenChange={(open) => {
          if (!open) {
            setInternalSelectedEdge(
              null
            );
          }
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-3xl border border-slate-800 bg-[#0b101d] p-6.5 text-slate-100 shadow-2xl backdrop-blur-xl">
          <DialogHeader className="border-b border-slate-800 pb-3.5">
            <DialogTitle className="flex items-center justify-between gap-2.5 text-xl font-black text-white">
              <div className="flex items-center gap-2.5">
                <span className="text-2xl">
                  🕵️‍♂️
                </span>

                Executive Investigation Connection Storyline
              </div>

              {internalSelectedEdge && (
                <Badge
                  variant="outline"
                  className="border-amber-500/60 bg-amber-950/80 px-2.5 py-1 font-mono text-xs font-bold text-amber-300"
                >
                  AI Confidence:{" "}
                  {Math.round(
                    internalSelectedEdge.weight *
                      100
                  )}
                  %
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          {internalSelectedEdge &&
            (() => {
              const srcNode =
                nodes.find(
                  (node) =>
                    node.id ===
                    internalSelectedEdge.sourceId
                );

              const tgtNode =
                nodes.find(
                  (node) =>
                    node.id ===
                    internalSelectedEdge.targetId
                );

              const srcName =
                srcNode?.label ||
                internalSelectedEdge.sourceId;

              const tgtName =
                tgtNode?.label ||
                internalSelectedEdge.targetId;

              const inkType =
                classifyEdge(
                  internalSelectedEdge
                );

              const rel =
                internalSelectedEdge.relationType ||
                "associate";

              const inkStyle =
                EDGE_STYLES[
                  inkType
                ];

              const evidence =
                internalSelectedEdge.evidence ||
                "No evidence description available.";

              const explanation =
                internalSelectedEdge.shortExplanation ||
                "";

              const elaboration =
                internalSelectedEdge.elaboration ||
                "";

              return (
                <div className="mt-2 space-y-4 text-sm">
                  {/* Relationship header */}
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl">
                    <div className="flex flex-col items-center rounded-xl border border-slate-800 bg-slate-950 p-3 text-center shadow-md">
                      <span className="max-w-[170px] truncate text-base font-black text-white">
                        {srcName}
                      </span>

                      <div className="mt-1 flex items-center gap-1">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-300">
                          {srcNode?.role ||
                            "ENTITY"}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col items-center px-2">
                      <div
                        className="flex h-10 w-10 items-center justify-center rounded-full font-extrabold text-lg shadow-lg"
                        style={{
                          backgroundColor:
                            `${inkStyle.stroke}22`,
                          borderColor:
                            `${inkStyle.stroke}80`,
                          borderWidth: 1,
                          color:
                            inkStyle.labelColor,
                        }}
                      >
                        ↔
                      </div>

                      <span
                        className="mt-1 rounded-full px-2 py-0.5 font-mono text-[10px] font-bold"
                        style={{
                          color:
                            inkStyle.labelColor,
                          backgroundColor:
                            `${inkStyle.stroke}18`,
                          borderColor:
                            `${inkStyle.stroke}55`,
                          borderWidth: 1,
                        }}
                      >
                        {inkType.toUpperCase()}
                      </span>
                    </div>

                    <div className="flex flex-col items-center rounded-xl border border-slate-800 bg-slate-950 p-3 text-center shadow-md">
                      <span className="max-w-[170px] truncate text-base font-black text-white">
                        {tgtName}
                      </span>

                      <div className="mt-1 flex items-center gap-1">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-300">
                          {tgtNode?.role ||
                            "ENTITY"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Classification */}
                  <div
                    className="rounded-2xl border p-4"
                    style={{
                      borderColor:
                        `${inkStyle.stroke}55`,
                      backgroundColor:
                        `${inkStyle.stroke}0d`,
                    }}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-black uppercase tracking-wider text-slate-400">
                        SAKSHYA Evidence Classification
                      </span>

                      <span
                        className="rounded-md border px-2 py-1 text-[10px] font-black uppercase tracking-wider"
                        style={{
                          color:
                            inkStyle.labelColor,
                          borderColor:
                            `${inkStyle.stroke}66`,
                        }}
                      >
                        {inkType}
                      </span>
                    </div>

                    <div className="text-sm font-bold text-slate-200">
                      Relationship:{" "}
                      <span className="capitalize">
                        {rel.replace(
                          /_/g,
                          " "
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Evidence */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-400">
                      <span>📋</span>
                      Evidence Basis
                    </div>

                    <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5 text-xs leading-relaxed text-slate-200 shadow-2xl whitespace-pre-line">
                      {evidence}
                    </div>
                  </div>

                  {/* Explanation */}
                  {explanation && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-400">
                        <span>🧠</span>
                        Relationship Explanation
                      </div>

                      <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5 text-xs leading-relaxed text-slate-200 shadow-2xl whitespace-pre-line">
                        {explanation}
                      </div>
                    </div>
                  )}

                  {/* Full storyline */}
                  {elaboration && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-400">
                        <span>📖</span>
                        Investigation Background & Case Storyline Breakdown
                      </div>

                      <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5 text-xs font-normal leading-relaxed text-slate-200 shadow-2xl whitespace-pre-line">
                        {elaboration}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}