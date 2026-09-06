"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { 
  Network, 
  Crown, 
  Users, 
  ChevronRight, 
  ExternalLink, 
  RefreshCw, 
  AlertCircle 
} from "lucide-react";
import { api, extractErrorMessage } from "@/lib/api";
import type { CaseSummary, NetworkPayload } from "@shared/types";

export function CaseNetworkSimulationWidget() {
  const router = useRouter();

  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string>("");
  const [casesLoading, setCasesLoading] = useState<boolean>(true);

  const [network, setNetwork] = useState<NetworkPayload | null>(null);
  const [networkLoading, setNetworkLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // 1. Fetch cases from backend and safely extract from { data: [...], total: 7 }
  useEffect(() => {
    setCasesLoading(true);
    api
      .get<any>("/cases")
      .then((res) => {
        const raw = res.data;
        // Handles both direct arrays and wrapped { data: [...] } responses
        const casesList: CaseSummary[] = Array.isArray(raw)
          ? raw
          : Array.isArray(raw?.data)
          ? raw.data
          : [];

        if (casesList.length > 0) {
          setCases(casesList);

          // Priority auto-selection: select CRITICAL first, then HIGH, else first case
          const defaultCase =
            casesList.find((c) => c.priority === "CRITICAL") ??
            casesList.find((c) => c.priority === "HIGH") ??
            casesList[0];

          if (defaultCase) {
            setSelectedCaseId(defaultCase.id);
          }
        }
      })
      .catch((err) => setError(extractErrorMessage(err)))
      .finally(() => setCasesLoading(false));
  }, []);

  // 2. Fetch network graph whenever the dropdown selection changes
  useEffect(() => {
    if (!selectedCaseId) return;

    setNetworkLoading(true);
    setError(null);
    api
      .get<any>(`/case/${selectedCaseId}/network`)
      .then((res) => {
        const raw = res.data;
        // Normalize in case the network payload is also wrapped in { data: ... }
        const payload: NetworkPayload = raw?.nodes
          ? raw
          : raw?.data?.nodes
          ? raw.data
          : raw;
        setNetwork(payload);
      })
      .catch((err) => setError(extractErrorMessage(err)))
      .finally(() => setNetworkLoading(false));
  }, [selectedCaseId]);

  const activeCase = useMemo(
    () => cases.find((c) => c.id === selectedCaseId),
    [cases, selectedCaseId]
  );

  // Identify central Kingpin hub and radial peripheral nodes
  const { kingpin, peripheralNodes } = useMemo(() => {
    if (!network?.nodes || network.nodes.length === 0) {
      return { kingpin: null, peripheralNodes: [] };
    }

    // Identify node with role === "KINGPIN" or highest kingpinScore
    const kp =
      network.nodes.find((n) => n.role === "KINGPIN") ??
      network.nodes.reduce((highest, current) =>
        current.kingpinScore > (highest?.kingpinScore ?? -1) ? current : highest
      , network.nodes[0]);

    // Position surrounding brokers/executors in a clean radial circle
    const others = network.nodes
      .filter((n) => n.id !== kp?.id)
      .slice(0, 6)
      .map((node, index, arr) => {
        const total = arr.length || 1;
        const angle = (2 * Math.PI * index) / total - Math.PI / 2;
        return {
          ...node,
          xPct: Math.round(50 + 34 * Math.cos(angle)),
          yPct: Math.round(48 + 36 * Math.sin(angle)),
        };
      });

    return { kingpin: kp, peripheralNodes: others };
  }, [network]);

  const handleNavigateToNetwork = () => {
    if (selectedCaseId) {
      router.push(`/cases/${selectedCaseId}/network`);
    }
  };

  return (
    <div className="relative rounded-xl border border-slate-200/90 bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)] flex flex-col justify-between">
      {/* Corner Reticles */}
      <span className="absolute top-0 left-0 h-2 w-2 border-t-2 border-l-2 border-slate-400 rounded-tl-[3px]" />
      <span className="absolute top-0 right-0 h-2 w-2 border-t-2 border-r-2 border-slate-400 rounded-tr-[3px]" />
      <span className="absolute bottom-0 left-0 h-2 w-2 border-b-2 border-l-2 border-slate-400 rounded-bl-[3px]" />
      <span className="absolute bottom-0 right-0 h-2 w-2 border-b-2 border-r-2 border-slate-400 rounded-br-[3px]" />

      {/* Header & Case Selector */}
      <div className="mb-4 border-b border-slate-100 pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div>
            <div className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
              <Network className="h-3 w-3 text-sky-600" />
              Relational Graph Simulation
            </div>
            <h2 className="text-base font-extrabold tracking-tight text-slate-900">
              Target Network Topology
            </h2>
          </div>

          {/* Case Dropdown */}
          <div className="flex items-center gap-2">
            {casesLoading ? (
              <span className="font-mono text-[11px] text-slate-400">Loading cases...</span>
            ) : (
              <select
                value={selectedCaseId}
                onChange={(e) => setSelectedCaseId(e.target.value)}
                className="h-8 max-w-[210px] truncate rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 font-mono text-[11px] font-bold text-slate-700 outline-none transition focus:border-sky-500 focus:bg-white"
              >
                {cases.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.caseNumber} — {c.title}
                  </option>
                ))}
              </select>
            )}

            {activeCase?.priority && (
              <span
                className={`rounded border px-2 py-0.5 font-mono text-[10px] font-extrabold shrink-0 ${
                  activeCase.priority === "CRITICAL"
                    ? "bg-red-50 text-red-700 border-red-200"
                    : activeCase.priority === "HIGH"
                    ? "bg-amber-50 text-amber-700 border-amber-200"
                    : "bg-slate-50 text-slate-600 border-slate-200"
                }`}
              >
                {activeCase.priority}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Graph Simulation Canvas */}
      <div 
        onClick={handleNavigateToNetwork}
        className="relative h-[310px] overflow-hidden rounded-xl border border-slate-200/80 bg-[#F8FAFC] cursor-pointer group transition hover:border-sky-300"
        title="Click to launch interactive network workspace"
      >
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "linear-gradient(#CBD5E1 1px, transparent 1px), linear-gradient(90deg, #CBD5E1 1px, transparent 1px)",
            backgroundSize: "26px 26px",
          }}
        />

        {/* Radial orbit guides */}
        <div className="absolute left-1/2 top-[48%] h-44 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full border border-slate-300/60 border-dashed animate-[spin_60s_linear_infinite]" />
        <div className="absolute left-1/2 top-[48%] h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full border border-slate-200/80" />

        {networkLoading ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/70 backdrop-blur-xs font-mono text-xs text-slate-500 z-30">
            <RefreshCw className="h-5 w-5 animate-spin text-sky-600 mb-2" />
            SYNCHRONIZING GRAPH NODES...
          </div>
        ) : error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center z-20">
            <AlertCircle className="h-6 w-6 text-red-500 mb-2" />
            <span className="font-mono text-xs font-bold text-slate-800">Topology Error</span>
            <span className="text-[11px] text-slate-500 mt-1">{error}</span>
          </div>
        ) : !network?.nodes || network.nodes.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center z-20">
            <Users className="h-8 w-8 text-slate-300 mb-2" />
            <span className="font-mono text-xs font-bold text-slate-700 uppercase">No Entities Mapped</span>
            <span className="text-[11px] text-slate-400 mt-1">
              Click to open case intake and process initial evidence FIR.
            </span>
          </div>
        ) : (
          <>
            {/* SVG Connecting Edges */}
            <svg className="absolute inset-0 h-full w-full pointer-events-none">
              {peripheralNodes.map((node) => (
                <line
                  key={node.id}
                  x1="50%"
                  y1="48%"
                  x2={`${node.xPct}%`}
                  y2={`${node.yPct}%`}
                  stroke="#CBD5E1"
                  strokeWidth="2"
                  strokeDasharray="4 4"
                  className="group-hover:stroke-sky-300 transition-colors"
                />
              ))}
            </svg>

            {/* Central Kingpin Hub */}
            {kingpin && (
              <div className="absolute left-1/2 top-[48%] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center z-20">
                <div className="relative flex h-13 w-13 items-center justify-center rounded-full border-[3px] border-white bg-red-600 shadow-[0_4px_20px_rgba(220,38,38,0.35)] group-hover:scale-110 transition-transform">
                  <span className="absolute -inset-1 rounded-full border-2 border-red-400/40 animate-ping" />
                  <Crown className="h-6 w-6 text-white" />
                </div>
                <div className="mt-1 flex flex-col items-center rounded-md border border-red-200 bg-white/95 px-2 py-0.5 shadow-sm backdrop-blur-sm max-w-[130px]">
                  <span className="font-mono text-[10px] font-black tracking-wider text-red-700 uppercase truncate w-full text-center">
                    {kingpin.label}
                  </span>
                  <span className="font-mono text-[8px] font-bold text-slate-500 uppercase">
                    SCORE: {kingpin.kingpinScore?.toFixed(0) ?? 0}%
                  </span>
                </div>
              </div>
            )}

            {/* Surrounding Nodes */}
            {peripheralNodes.map((node) => (
              <div
                key={node.id}
                className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center z-10"
                style={{ left: `${node.xPct}%`, top: `${node.yPct}%` }}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-slate-800 text-white shadow-md group-hover:bg-sky-600 transition-colors">
                  <Users className="h-3.5 w-3.5" />
                </div>
                <div className="mt-1 flex flex-col items-center rounded border border-slate-200 bg-white/90 px-1.5 py-0.5 shadow-xs backdrop-blur-sm max-w-[100px]">
                  <span className="font-mono text-[9px] font-bold text-slate-800 uppercase truncate w-full text-center">
                    {node.label}
                  </span>
                  <span className="font-mono text-[8px] text-slate-400 truncate w-full text-center">
                    {node.role}
                  </span>
                </div>
              </div>
            ))}

            {/* Summary Badge */}
            <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 rounded-md border border-slate-200/90 bg-white/90 px-2 py-1 shadow-xs backdrop-blur-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-sky-500 animate-pulse" />
              <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-slate-600">
                {network.metrics?.node_count ?? network.nodes.length} Nodes · {network.metrics?.edge_count ?? network.edges.length} Edges
              </span>
            </div>
          </>
        )}

        {/* Hover Action Badge */}
        <div className="absolute bottom-3 right-3 z-20">
          <span className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-white/95 px-2.5 py-1 font-mono text-[10px] font-bold text-sky-700 shadow-sm transition group-hover:bg-sky-600 group-hover:text-white group-hover:border-sky-600">
            LAUNCH FULL WORKSPACE <ExternalLink className="h-3 w-3" />
          </span>
        </div>
      </div>

      {/* Footer Link */}
      <div className="mt-3 flex items-center justify-between pt-2 border-t border-slate-100 font-mono text-[11px]">
        <span className="text-slate-400 text-[10px]">
          Target: <strong className="text-slate-700">{activeCase?.caseNumber ?? "NONE"}</strong>
        </span>
        <button
          type="button"
          onClick={handleNavigateToNetwork}
          disabled={!selectedCaseId}
          className="flex items-center gap-1 font-bold text-sky-700 hover:text-sky-900 transition disabled:opacity-50"
        >
          Open Case Graph <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}