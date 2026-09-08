"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bell,
  ChevronDown,
  ChevronRight,
  Clock3,
  Crosshair,
  Crown,
  FolderOpen,
  MapPin,
  Network,
  Radio,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Users,
  X,
} from "lucide-react";

import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";

import { api, extractErrorMessage } from "@/lib/api";
import { KPICards } from "@/components/analytics/KPICards";
import { CaseNetworkSimulationWidget } from "@/components/graph/CaseNetworkSimulationWidget";
type DashboardPayload = Record<string, unknown>;
import type { DashboardKpis } from "@shared/types";

/* =========================================================
   TYPES
========================================================= */

type GenericRecord = Record<string, unknown>;

type TimelineEvent = {
  id: number;
  month: string;
  date: string;
  title: string;
  description: string;
  type: "investigation" | "evidence" | "network" | "case";
  position: number;
};

type DistributionItem = {
  name: string;
  count: number;
};

type InspectedEntity = {
  id: string;
  codename: string;
  role: string;
  riskScore: number;
  connections: number;
  status: string;
  sector: string;
};

/* =========================================================
   HELPERS
========================================================= */

function isRecord(value: unknown): value is GenericRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function getNestedObject(
  source: GenericRecord,
  key: string
): GenericRecord | null {
  const value = source[key];
  return isRecord(value) ? value : null;
}

function findDistribution(
  source: unknown,
  dimension: "status" | "priority"
): DistributionItem[] {
  const root = isRecord(source) ? source : {};

  const preferredKeys =
    dimension === "status"
      ? [
          "byStatus",
          "statusDistribution",
          "caseStatus",
          "caseStatuses",
          "statuses",
          "status",
          "casesByStatus",
        ]
      : [
          "byPriority",
          "priorityDistribution",
          "casePriority",
          "casePriorities",
          "priorities",
          "priority",
          "casesByPriority",
        ];

  for (const key of preferredKeys) {
    const direct = root[key];

    if (Array.isArray(direct)) {
      const result = direct
        .map((item) => {
          if (!isRecord(item)) return null;

          const rawName =
            item[dimension] ??
            item.name ??
            item.label ??
            item.key;

          const rawCount =
            item.count ??
            item.total ??
            item.value ??
            item._count;

          if (typeof rawName !== "string") return null;

          return {
            name: rawName,
            count: asNumber(rawCount),
          };
        })
        .filter((item): item is DistributionItem => item !== null);

      if (result.length > 0) {
        return result;
      }
    }
  }

  return [];
}

function findDistributionDeep(
  source: unknown,
  dimension: "status" | "priority",
  depth = 0
): DistributionItem[] {
  if (depth > 3 || source == null) {
    return [];
  }

  const direct = findDistribution(source, dimension);
  if (direct.length > 0) return direct;

  if (!isRecord(source)) return [];

  for (const value of Object.values(source)) {
    if (Array.isArray(value)) {
      const result = findDistribution(value, dimension);
      if (result.length > 0) return result;
    }

    if (isRecord(value)) {
      const result = findDistributionDeep(value, dimension, depth + 1);
      if (result.length > 0) return result;
    }
  }

  return [];
}

/* =========================================================
   STATIC SURVEILLANCE & TIMELINE DATA
========================================================= */

const TIMELINE_EVENTS: TimelineEvent[] = [
  {
    id: 1,
    month: "MAR",
    date: "March 2024",
    title: "Investigation Activity",
    description: "Primary FIR logged & cross-indexed",
    type: "investigation",
    position: 19,
  },
  {
    id: 2,
    month: "APR",
    date: "April 2024",
    title: "Evidence Activity",
    description: "Encrypted device seized & imaged",
    type: "evidence",
    position: 31,
  },
  {
    id: 3,
    month: "JUN",
    date: "June 2024",
    title: "Network Activity",
    description: "Ghost link established to Hawala channel",
    type: "network",
    position: 50,
  },
  {
    id: 4,
    month: "AUG",
    date: "August 2024",
    title: "Evidence Activity",
    description: "CDR telemetry linked to secondary syndicate",
    type: "evidence",
    position: 68,
  },
  {
    id: 5,
    month: "OCT",
    date: "October 2024",
    title: "Case Activity",
    description: "Charge-sheet finalized for special court",
    type: "case",
    position: 84,
  },
];

const MONTHS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

const ACTIVITY_BARS = [
  25, 38, 20, 46, 31, 52, 36, 28, 58, 42, 34, 50, 44, 35, 57, 66, 43, 32,
  51, 70, 46, 38, 62, 49, 67, 53, 40, 61, 45, 72, 55, 39, 57, 68, 47, 62,
  44, 54, 65, 50, 73, 58, 45, 57, 71, 51, 63, 55, 69, 48, 60, 67, 52, 72,
];

/* =========================================================
   PALETTE DEFINITIONS
========================================================= */

const STATUS_COLORS: Record<string, string> = {
  OPEN: "#0284C7",
  UNDER_INVESTIGATION: "#D97706",
  PENDING_REVIEW: "#7C3AED",
  CLOSED: "#059669",
  COLD: "#64748B",
};

const PRIORITY_COLORS: Record<string, string> = {
  LOW: "#059669",
  MEDIUM: "#D97706",
  HIGH: "#EA580C",
  CRITICAL: "#DC2626",
};

/* =========================================================
   SUBCOMPONENTS
========================================================= */

function SectionLabel({
  children,
  icon,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="mb-1.5 flex items-center gap-1.5">
      {icon && <span className="text-sky-600">{icon}</span>}
      <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">
        {children}
      </span>
    </div>
  );
}

function EmptyChartState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex h-[280px] items-center justify-center">
      <div className="max-w-xs text-center px-4">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-400">
          <Activity className="h-5 w-5" />
        </div>
        <p className="mt-3 text-sm font-bold text-slate-800">{title}</p>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">{description}</p>
      </div>
    </div>
  );
}

function TelemetryTicker({ unresolvedAlerts = 0 }: { unresolvedAlerts: number }) {
  const [activeTickIndex, setActiveTickIndex] = useState(0);

  const feeds = [
    { time: "02:14:08 IST", type: "ANOMALY", text: "Cross-district SIM churn anomaly detected across 4 linked dossiers", high: true },
    { time: "02:11:42 IST", type: "INGEST", text: "Batch sync complete: 18 FIR intake documents parsed & vectorized", high: false },
    { time: "02:08:19 IST", type: "NETWORK", text: "Ghost link identified between Target KP-01 and Hawala Operator #9", high: true },
    { time: "02:01:05 IST", type: "GEOSPATIAL", text: "Signal triangulation verified within Sector 7 radius (Nagpur Rural)", high: false },
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveTickIndex((prev) => (prev + 1) % feeds.length);
    }, 4500);
    return () => clearInterval(timer);
  }, [feeds.length]);

  const current = feeds[activeTickIndex] ?? feeds[0]!;

  return (
    <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 rounded-xl border border-slate-200/90 bg-white px-4 py-2.5 shadow-sm">
      <div className="flex items-center gap-3 overflow-hidden">
        <span className="flex items-center gap-1.5 font-mono text-[10px] font-black uppercase tracking-wider text-slate-500 shrink-0">
          <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
          Live Telemetry
        </span>
        <span className="text-slate-200">|</span>
        <div className="flex items-center gap-2 text-xs truncate">
          <span className="font-mono text-[11px] font-semibold text-slate-400 shrink-0">
            [{current.time}]
          </span>
          <span
            className={`font-mono text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider ${
              current.high
                ? "bg-red-50 text-red-700 border-red-200"
                : "bg-sky-50 text-sky-700 border-sky-200"
            }`}
          >
            {current.type}
          </span>
          <span className="truncate text-slate-700 font-medium">{current.text}</span>
        </div>
      </div>

      <div className="flex items-center gap-2.5 shrink-0 border-t md:border-t-0 md:border-l border-slate-100 pt-2 md:pt-0 md:pl-4">
        <span className="font-mono text-[10px] uppercase font-bold text-slate-400">Threat Advisory</span>
        <div className="flex items-center gap-1">
          <span className="h-2 w-3 rounded-xs bg-emerald-500" />
          <span className="h-2 w-3 rounded-xs bg-amber-500" />
          <span className="h-2 w-3 rounded-xs bg-red-500 animate-pulse" />
        </div>
        <span className="font-mono text-[10px] font-bold text-red-700 bg-red-50 border border-red-200/80 px-2 py-0.5 rounded">
          {unresolvedAlerts > 0 ? "LEVEL 3 // ELEVATED" : "LEVEL 1 // NOMINAL"}
        </span>
      </div>
    </div>
  );
}

/* =========================================================
   MAIN PAGE
========================================================= */

export default function DashboardPage() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedTimeline, setSelectedTimeline] =
    useState<TimelineEvent | null>(TIMELINE_EVENTS[2] ?? TIMELINE_EVENTS[0] ?? null);

  const [timelineRange, setTimelineRange] = useState("1 YEAR");
  const [timelineMenuOpen, setTimelineMenuOpen] = useState(false);

  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [selectedPriority, setSelectedPriority] = useState<string | null>(null);

  const [inspectedEntity, setInspectedEntity] = useState<InspectedEntity | null>(null);

  /* =======================================================
     API CALL
  ======================================================= */

  const loadDashboard = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await api.get("/analytics/dashboard");
      setData(response.data);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  const firstName = "Officer";
  const roleLabel = "Investigation Command";

  /* =======================================================
     NORMALIZE PAYLOAD
  ======================================================= */

  const dashboardRecord = useMemo<GenericRecord>(() => {
    return isRecord(data) ? data : {};
  }, [data]);

  const kpiSource = useMemo<GenericRecord>(() => {
    const nested =
      getNestedObject(dashboardRecord, "kpis") ??
      getNestedObject(dashboardRecord, "KPI") ??
      getNestedObject(dashboardRecord, "metrics");

    return nested ?? dashboardRecord;
  }, [dashboardRecord]);

  const kpis = useMemo<DashboardKpis>(() => {
    return {
      totalCases: asNumber(kpiSource.totalCases),
      openCases: asNumber(kpiSource.openCases),
      highPriority: asNumber(kpiSource.highPriority),
      suspects: asNumber(kpiSource.suspects),
      evidenceCount: asNumber(kpiSource.evidenceCount),
      unresolvedAlerts: asNumber(kpiSource.unresolvedAlerts),
      kingpins: asNumber(kpiSource.kingpins),
    };
  }, [kpiSource]);

  const statusData = useMemo(() => {
    return findDistributionDeep(dashboardRecord, "status");
  }, [dashboardRecord]);

  const priorityData = useMemo(() => {
    return findDistributionDeep(dashboardRecord, "priority");
  }, [dashboardRecord]);

  const visibleTimelineEvents = useMemo(() => {
    if (timelineRange === "3 MONTHS") return TIMELINE_EVENTS.slice(-2);
    if (timelineRange === "6 MONTHS") return TIMELINE_EVENTS.slice(-3);
    return TIMELINE_EVENTS;
  }, [timelineRange]);

  return (
    <div className="min-h-screen bg-[#F4F7FB] text-slate-800 antialiased selection:bg-amber-100 selection:text-amber-900">
      
      {/* =====================================================
          COMMAND HEADER
      ===================================================== */}
      <section className="border-b border-slate-200/80 bg-white/95 backdrop-blur-md px-6 py-5 lg:px-10 sticky top-0 z-30 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
        <div className="max-w-[1700px] mx-auto flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
              </span>
              <span className="text-[10px] font-extrabold uppercase tracking-[0.25em] text-slate-400">
                CrimeNetX Intelligence Operations
              </span>
              <span className="text-slate-300 font-mono text-xs">|</span>
              <span className="font-mono text-[10px] text-slate-500 font-semibold uppercase">
                STATION ID: CR-IN-NGP-01
              </span>
            </div>

            <h1 className="text-xl md:text-2xl font-black tracking-tight text-slate-900">
              Good afternoon, {firstName}
            </h1>

            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <span className="inline-flex items-center gap-1 rounded border border-amber-200/80 bg-amber-50/80 px-2 py-0.5 font-bold text-amber-800 text-[11px]">
                {roleLabel}
              </span>
              <span className="text-slate-300">•</span>
              <span className="font-medium text-slate-600 text-[13px]">
                State-wide intelligence &amp; kingpin oversight stream
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex h-9 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/80 px-3.5 shadow-sm">
              <span className="h-2 w-2 rounded-full bg-emerald-600 shadow-[0_0_8px_rgba(5,150,105,0.4)]" />
              <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-emerald-800">
                System Online
              </span>
            </div>

            <button
              type="button"
              onClick={loadDashboard}
              disabled={loading}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50"
              title="Refresh intelligence streams"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin text-sky-600" : ""}`} />
            </button>
          </div>
        </div>
      </section>

      {/* =====================================================
          MAIN DASHBOARD BODY
      ===================================================== */}
      <main className="max-w-[1700px] mx-auto space-y-6 px-6 py-6 lg:px-10 lg:py-8">
        
        {/* TELEMETRY ADVISORY STRIP */}
        <TelemetryTicker unresolvedAlerts={kpis.unresolvedAlerts} />

        {/* ERROR NOTIFICATION */}
        {error && (
          <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50/90 px-4 py-3 text-xs font-semibold text-red-700 shadow-sm">
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
            <span>{error}</span>
          </div>
        )}

        {/* ===================================================
            1. KPI INTELLIGENCE TILES
        =================================================== */}
        <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
          <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3.5">
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-slate-400">
                Live Status Strips
              </p>
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-800">
                Operational Metrics
              </h2>
            </div>
            <div className="flex items-center gap-2 font-mono text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200/60 px-2.5 py-1 rounded-md">
              <Radio className="h-3 w-3 animate-pulse text-emerald-600" />
              Direct Feed Synced
            </div>
          </div>

          <KPICards kpis={kpis} loading={loading} />
        </div>

        {/* ===================================================
            2. TEMPORAL SURVEILLANCE TIMELINE
        =================================================== */}
        <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
          <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <SectionLabel icon={<Clock3 className="h-3.5 w-3.5" />}>
                Temporal Intelligence
              </SectionLabel>
              <h2 className="text-base font-extrabold text-slate-900 tracking-tight">
                Investigation Timeline
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Chronological movement of cases, physical evidence, and network alterations.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setTimelineMenuOpen((val) => !val)}
                  className="flex h-8 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/80 px-3 font-mono text-[11px] font-bold text-slate-700 shadow-sm transition hover:bg-slate-100 hover:text-slate-900"
                >
                  {timelineRange}
                  <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                </button>

                {timelineMenuOpen && (
                  <div className="absolute right-0 top-10 z-50 w-36 overflow-hidden rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                    {["3 MONTHS", "6 MONTHS", "1 YEAR"].map((range) => (
                      <button
                        key={range}
                        type="button"
                        onClick={() => {
                          setTimelineRange(range);
                          setTimelineMenuOpen(false);
                        }}
                        className={`flex w-full rounded px-2.5 py-1.5 text-left font-mono text-[11px] font-semibold transition ${
                          timelineRange === range
                            ? "bg-slate-100 text-sky-700"
                            : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                        }`}
                      >
                        {range}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() =>
                  setSelectedTimeline(visibleTimelineEvents[visibleTimelineEvents.length - 1] ?? null)
                }
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50/80 text-slate-600 shadow-sm transition hover:bg-slate-100 hover:text-slate-900"
                title="Latest Activity"
              >
                <Clock3 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-slate-200/80 bg-slate-50/50 p-4">
            <div className="grid grid-cols-12 border-b border-slate-200/80 pb-2.5">
              {MONTHS.map((month) => (
                <div
                  key={month}
                  className="text-center font-mono text-[10px] font-bold tracking-widest text-slate-400"
                >
                  {month}
                </div>
              ))}
            </div>

            <div className="relative mt-3 h-[270px]">
              <div className="pointer-events-none absolute inset-0 grid grid-cols-12">
                {MONTHS.map((month) => (
                  <div key={month} className="border-r border-slate-200/50" />
                ))}
              </div>

              <div className="absolute left-0 right-0 top-1/2 h-[2px] bg-slate-300 rounded-full" />

              {visibleTimelineEvents.map((event, index) => {
                const selected = selectedTimeline?.id === event.id;
                const isBottom = index % 2 === 1;

                const eventColor =
                  event.type === "evidence"
                    ? "#D97706"
                    : event.type === "network"
                      ? "#7C3AED"
                      : event.type === "case"
                        ? "#059669"
                        : "#0284C7";

                return (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => setSelectedTimeline(event)}
                    className="group absolute top-1/2 -translate-x-1/2 focus:outline-none"
                    style={{ left: `${event.position}%` }}
                  >
                    <span
                      className={`absolute left-1/2 w-[2px] -translate-x-1/2 transition-colors ${
                        selected ? "bg-slate-800" : "bg-slate-300 group-hover:bg-slate-500"
                      } ${isBottom ? "top-[9px] h-[48px]" : "bottom-[9px] h-[48px]"}`}
                    />

                    <span
                      className={`relative z-20 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white shadow-sm transition-all duration-150 ${
                        selected
                          ? "scale-125 ring-2 ring-slate-900"
                          : "group-hover:scale-110"
                      }`}
                      style={{ backgroundColor: eventColor }}
                    />

                    <div
                      className={`absolute left-1/2 w-44 -translate-x-1/2 rounded-lg border bg-white p-2.5 text-left shadow-[0_4px_12px_rgba(0,0,0,0.06)] transition-all ${
                        isBottom ? "top-[62px]" : "bottom-[62px]"
                      } ${
                        selected
                          ? "border-sky-500 ring-2 ring-sky-100"
                          : "border-slate-200 group-hover:border-slate-300"
                      }`}
                    >
                      <span
                        className="font-mono text-[9px] font-black uppercase tracking-wider block"
                        style={{ color: eventColor }}
                      >
                        {event.month} // {event.type}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] font-bold text-slate-800">
                        {event.title}
                      </span>
                      <span className="block truncate text-[10px] text-slate-500">
                        {event.description}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            {selectedTimeline && (
              <div className="mt-3 flex items-center justify-between rounded-lg border border-sky-200/80 bg-sky-50/60 px-3.5 py-2">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-6 w-6 items-center justify-center rounded bg-sky-600 text-white shadow-sm">
                    <Sparkles className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-800">
                      {selectedTimeline.title}
                    </span>
                    <span className="ml-2 font-mono text-[11px] text-slate-500">
                      [{selectedTimeline.date} — {selectedTimeline.description}]
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedTimeline(null)}
                  className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700 transition"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            <div className="mt-4 border-t border-slate-200/80 pt-3">
              <div className="flex h-7 items-end gap-1">
                {ACTIVITY_BARS.map((height, index) => (
                  <div
                    key={index}
                    className="flex-1 rounded-t-sm bg-slate-200 transition hover:bg-sky-500"
                    style={{ height: `${height}%` }}
                  />
                ))}
              </div>
              <div className="mt-1 flex justify-between font-mono text-[9px] uppercase tracking-wider text-slate-400">
                <span>Surveillance Volume</span>
                <span>Signal Frequency</span>
              </div>
            </div>
          </div>
        </div>

    {/* ===================================================
            3. RADAR-ENABLED GEOSPATIAL & NETWORK WORKBENCH
        =================================================== */}
        <div className="grid gap-6 xl:grid-cols-2">
          
          {/* LEFT: Keep your existing Geospatial Radar Card */}
          <div className="relative rounded-xl border border-slate-200/90 bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
            <span className="absolute top-0 left-0 h-2 w-2 border-t-2 border-l-2 border-slate-400 rounded-tl-[3px]" />
            <span className="absolute top-0 right-0 h-2 w-2 border-t-2 border-r-2 border-slate-400 rounded-tr-[3px]" />
            <span className="absolute bottom-0 left-0 h-2 w-2 border-b-2 border-l-2 border-slate-400 rounded-bl-[3px]" />
            <span className="absolute bottom-0 right-0 h-2 w-2 border-b-2 border-r-2 border-slate-400 rounded-br-[3px]" />

            <div className="mb-4 flex items-start justify-between border-b border-slate-100 pb-3">
              <div>
                <SectionLabel icon={<MapPin className="h-3.5 w-3.5" />}>
                  Geospatial Triangulation
                </SectionLabel>
                <h2 className="text-base font-extrabold tracking-tight text-slate-900">
                  Incident Coordinates &amp; Radar
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Live sweeping antenna sweep over active crime sectors.
                </p>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
                <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[10px] font-bold text-slate-600">
                  RADAR ACTIVE // 360°
                </span>
              </div>
            </div>

            {/* Existing radar sweep box */}
            <div className="relative h-[320px] overflow-hidden rounded-xl border border-slate-200/80 bg-[#F8FAFC]">
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
                <div 
                  className="h-[440px] w-[440px] rounded-full border border-sky-300/40 opacity-75 animate-[spin_7s_linear_infinite]"
                  style={{
                    background: "conic-gradient(from 0deg, rgba(2, 132, 199, 0.18) 0deg, rgba(2, 132, 199, 0.05) 45deg, transparent 75deg, transparent 360deg)"
                  }}
                />
              </div>

              <div
                className="absolute inset-0 opacity-40"
                style={{
                  backgroundImage:
                    "linear-gradient(#CBD5E1 1px, transparent 1px), linear-gradient(90deg, #CBD5E1 1px, transparent 1px)",
                  backgroundSize: "26px 26px",
                }}
              />

              <div className="absolute left-1/2 top-1/2 h-32 w-32 -translate-x-1/2 -translate-y-1/2 rounded-full border border-slate-300/80 border-dashed">
                <span className="absolute top-1 left-1/2 -translate-x-1/2 font-mono text-[8px] font-bold text-slate-400">5 KM</span>
              </div>
              <div className="absolute left-1/2 top-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full border border-slate-300/70">
                <span className="absolute top-1 left-1/2 -translate-x-1/2 font-mono text-[8px] font-bold text-slate-400">10 KM</span>
              </div>
              <div className="absolute left-1/2 top-1/2 h-76 w-76 -translate-x-1/2 -translate-y-1/2 rounded-full border border-slate-200">
                <span className="absolute top-1 left-1/2 -translate-x-1/2 font-mono text-[8px] font-bold text-slate-400">15 KM</span>
              </div>

              <div className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-300/60" />
              <div className="absolute top-1/2 left-0 right-0 h-px bg-slate-300/60" />

              <span className="absolute top-1.5 left-1/2 -translate-x-1/2 font-mono text-[8px] font-bold text-slate-400">000° N</span>
              <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 font-mono text-[8px] font-bold text-slate-400">180° S</span>
              <span className="absolute left-1.5 top-1/2 -translate-y-1/2 font-mono text-[8px] font-bold text-slate-400">270° W</span>
              <span className="absolute right-1.5 top-1/2 -translate-y-1/2 font-mono text-[8px] font-bold text-slate-400">090° E</span>

              <div className="absolute left-[36%] top-[42%] flex items-center gap-2">
                <div className="relative flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-sky-600 shadow-md">
                  <span className="h-2 w-2 rounded-full bg-white" />
                </div>
                <div className="rounded-md border border-slate-200 bg-white/95 px-2 py-1 shadow-sm backdrop-blur-sm">
                  <p className="font-mono text-[10px] font-bold text-slate-900">SECTOR_NORTHEAST</p>
                  <p className="text-[9px] text-slate-500">Live Case Correlated</p>
                </div>
              </div>

              <div className="absolute left-[64%] top-[28%] flex items-center gap-2">
                <div className="relative flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-amber-500 shadow-md">
                  <span className="h-1.5 w-1.5 rounded-full bg-white" />
                </div>
                <span className="font-mono text-[9px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 shadow-sm">
                  POI_CELL_TOWER_LINK
                </span>
              </div>
            </div>
          </div>

          {/* RIGHT: Paste the Case Network Simulation Widget here */}
          <CaseNetworkSimulationWidget />

        </div>
{/* ===================================================
            4. ANALYTICS (TACTICAL STATUS & THREAT QUEUE)
        =================================================== */}
        <div className="grid gap-6 xl:grid-cols-2">
          
          {/* CASE STATUS: DONUT WITH CENTER METRICS & DETAILED LEGEND */}
          <div className="relative rounded-xl border border-slate-200/90 bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
            <span className="absolute top-0 left-0 h-2 w-2 border-t-2 border-l-2 border-slate-400 rounded-tl-[3px]" />
            <span className="absolute top-0 right-0 h-2 w-2 border-t-2 border-r-2 border-slate-400 rounded-tr-[3px]" />
            <span className="absolute bottom-0 left-0 h-2 w-2 border-b-2 border-l-2 border-slate-400 rounded-bl-[3px]" />
            <span className="absolute bottom-0 right-0 h-2 w-2 border-b-2 border-r-2 border-slate-400 rounded-br-[3px]" />

            <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <SectionLabel icon={<Activity className="h-3.5 w-3.5" />}>
                  Categorical Breakdown
                </SectionLabel>
                <h2 className="text-base font-extrabold tracking-tight text-slate-900">
                  Case Status Pipeline
                </h2>
              </div>
              <span className="font-mono text-[10px] font-bold text-slate-500 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded">
                PIPELINE ALLOCATION
              </span>
            </div>

            {statusData.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-12 items-center gap-4 min-h-[270px]">
                {/* Donut Chart with Centered Readout */}
                <div className="relative md:col-span-6 h-[240px] flex items-center justify-center">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={statusData}
                        dataKey="count"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={68}
                        outerRadius={92}
                        paddingAngle={4}
                        stroke="#FFFFFF"
                        strokeWidth={3}
                        onClick={(entry) =>
                          setSelectedStatus(String((entry as DistributionItem).name ?? ""))
                        }
                        style={{ cursor: "pointer" }}
                      >
                        {statusData.map((item) => (
                          <Cell
                            key={item.name}
                            fill={
                              STATUS_COLORS[item.name] ??
                              STATUS_COLORS[item.name.toUpperCase().replace(/ /g, "_")] ??
                              "#94A3B8"
                            }
                            opacity={selectedStatus && selectedStatus !== item.name ? 0.35 : 1}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#FFFFFF",
                          borderColor: "#E2E8F0",
                          borderRadius: "8px",
                          fontSize: "12px",
                          boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>

                  {/* Absolute Center Readout */}
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                    <span className="font-mono text-2xl font-black tracking-tight text-slate-900">
                      {statusData.reduce((acc, curr) => acc + curr.count, 0)}
                    </span>
                    <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-slate-400">
                      Total Cases
                    </span>
                  </div>
                </div>

                {/* Formatted Tactical Item Breakdown */}
                <div className="md:col-span-6 space-y-2.5 pr-2">
                  {statusData.map((item) => {
                    const total = statusData.reduce((acc, curr) => acc + curr.count, 0) || 1;
                    const percent = Math.round((item.count / total) * 100);
                    const color =
                      STATUS_COLORS[item.name] ??
                      STATUS_COLORS[item.name.toUpperCase().replace(/ /g, "_")] ??
                      "#94A3B8";
                    const cleanName = item.name.replace(/_/g, " ");

                    return (
                      <div
                        key={item.name}
                        onClick={() =>
                          setSelectedStatus(selectedStatus === item.name ? null : item.name)
                        }
                        className={`group cursor-pointer rounded-lg border p-2.5 transition-all ${
                          selectedStatus === item.name
                            ? "border-sky-500 bg-sky-50/50 shadow-xs"
                            : "border-slate-100 bg-slate-50/60 hover:border-slate-200 hover:bg-white"
                        }`}
                      >
                        <div className="flex items-center justify-between font-mono text-xs">
                          <span className="flex items-center gap-2 font-bold text-slate-700 capitalize">
                            <span
                              className="h-2 w-2 rounded-full shrink-0"
                              style={{ backgroundColor: color }}
                            />
                            {cleanName.toLowerCase()}
                          </span>
                          <span className="font-bold text-slate-900">
                            {item.count}{" "}
                            <span className="text-[10px] text-slate-400 font-normal">
                              ({percent}%)
                            </span>
                          </span>
                        </div>
                        <div className="mt-1.5 h-1 w-full bg-slate-200/70 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${percent}%`, backgroundColor: color }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <EmptyChartState
                title="Status Distribution Unavailable"
                description="The analytics engine returned no case status distributions."
              />
            )}
          </div>

          {/* PRIORITY QUEUE: TACTICAL HORIZONTAL SEVERITY METERS */}
          <div className="relative rounded-xl border border-slate-200/90 bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
            <span className="absolute top-0 left-0 h-2 w-2 border-t-2 border-l-2 border-slate-400 rounded-tl-[3px]" />
            <span className="absolute top-0 right-0 h-2 w-2 border-t-2 border-r-2 border-slate-400 rounded-tr-[3px]" />
            <span className="absolute bottom-0 left-0 h-2 w-2 border-b-2 border-l-2 border-slate-400 rounded-bl-[3px]" />
            <span className="absolute bottom-0 right-0 h-2 w-2 border-b-2 border-r-2 border-slate-400 rounded-br-[3px]" />

            <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <SectionLabel icon={<ShieldAlert className="h-3.5 w-3.5" />}>
                  Attention Queue
                </SectionLabel>
                <h2 className="text-base font-extrabold tracking-tight text-slate-900">
                  Risk Classification &amp; Workload
                </h2>
              </div>
              <span className="font-mono text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded">
                CRITICAL THRESHOLD
              </span>
            </div>

            {priorityData.length > 0 ? (
              <div className="space-y-3.5 py-1 min-h-[270px] flex flex-col justify-center">
                {/* Sort by severity hierarchy: Critical -> High -> Medium -> Low */}
                {[...priorityData]
                  .sort((a, b) => {
                    const order: Record<string, number> = { CRITICAL: 1, HIGH: 2, MEDIUM: 3, LOW: 4 };
                    return (order[a.name.toUpperCase()] ?? 5) - (order[b.name.toUpperCase()] ?? 5);
                  })
                  .map((item) => {
                    const total = priorityData.reduce((acc, curr) => acc + curr.count, 0) || 1;
                    const percent = Math.round((item.count / total) * 100);
                    const color =
                      PRIORITY_COLORS[item.name.toUpperCase()] ?? "#94A3B8";
                    const isCritical = item.name.toUpperCase() === "CRITICAL";

                    return (
                      <div
                        key={item.name}
                        onClick={() =>
                          setSelectedPriority(selectedPriority === item.name ? null : item.name)
                        }
                        className={`group cursor-pointer rounded-lg border p-3 transition-all ${
                          selectedPriority === item.name
                            ? "border-slate-800 bg-slate-50 shadow-xs"
                            : "border-slate-100 bg-slate-50/50 hover:bg-white hover:border-slate-200"
                        }`}
                      >
                        <div className="flex items-center justify-between font-mono text-xs">
                          <div className="flex items-center gap-2">
                            <span
                              className={`h-2 w-2 rounded-full ${
                                isCritical ? "animate-ping" : ""
                              }`}
                              style={{ backgroundColor: color }}
                            />
                            <span className="font-extrabold uppercase tracking-wide text-slate-800">
                              {item.name} PRIORITY
                            </span>
                          </div>

                          <div className="flex items-center gap-2 font-mono">
                            <span className="text-[11px] font-medium text-slate-400">
                              {percent}% QUEUE
                            </span>
                            <span
                              className="rounded border px-2 py-0.5 text-xs font-black"
                              style={{
                                color: color,
                                backgroundColor: `${color}15`,
                                borderColor: `${color}40`,
                              }}
                            >
                              {item.count.toString().padStart(2, "0")} CASES
                            </span>
                          </div>
                        </div>

                        {/* Segmented Risk Meter Bars */}
                        <div className="mt-2.5 flex gap-1 h-2">
                          {Array.from({ length: 24 }).map((_, i) => {
                            const activeCount = Math.ceil((percent / 100) * 24);
                            const isActive = i < activeCount;
                            return (
                              <div
                                key={i}
                                className={`flex-1 rounded-xs transition-colors ${
                                  isActive ? "" : "bg-slate-200/80"
                                }`}
                                style={{
                                  backgroundColor: isActive ? color : undefined,
                                }}
                              />
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
              </div>
            ) : (
              <EmptyChartState
                title="Priority Distribution Unavailable"
                description="The analytics engine returned no case priority allocations."
              />
            )}
          </div>

        </div>
        {/* ===================================================
            5. DISPATCH ACTIONS
        =================================================== */}
        <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
          <div className="mb-4 border-b border-slate-100 pb-3">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-slate-400">
              Direct Investigation Dispatch
            </p>
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-800">
              Module Operations
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Link
              href="/cases/new"
              className="group flex flex-col justify-between rounded-xl border border-slate-200/90 bg-slate-50/50 p-4 transition-all hover:bg-white hover:border-amber-400 hover:shadow-sm"
            >
              <div className="flex items-start justify-between">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 text-amber-700 shadow-sm">
                  <FolderOpen className="h-4 w-4" />
                </div>
                <ArrowRight className="h-4 w-4 text-slate-400 transition group-hover:translate-x-1 group-hover:text-amber-600" />
              </div>
              <div className="mt-4">
                <h3 className="text-sm font-bold text-slate-900">Case Intake</h3>
                <p className="mt-0.5 text-[11px] text-slate-500">Register a new investigation or FIR record.</p>
              </div>
            </Link>

            <Link
              href="/cases"
              className="group flex flex-col justify-between rounded-xl border border-slate-200/90 bg-slate-50/50 p-4 transition-all hover:bg-white hover:border-sky-400 hover:shadow-sm"
            >
              <div className="flex items-start justify-between">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-sky-200 bg-sky-50 text-sky-700 shadow-sm">
                  <Network className="h-4 w-4" />
                </div>
                <ArrowRight className="h-4 w-4 text-slate-400 transition group-hover:translate-x-1 group-hover:text-sky-600" />
              </div>
              <div className="mt-4">
                <h3 className="text-sm font-bold text-slate-900">Network Analysis</h3>
                <p className="mt-0.5 text-[11px] text-slate-500">Explore relational links, graph clusters, and ghost links.</p>
              </div>
            </Link>

            <Link
              href="/suspects"
              className="group flex flex-col justify-between rounded-xl border border-slate-200/90 bg-slate-50/50 p-4 transition-all hover:bg-white hover:border-sky-400 hover:shadow-sm"
            >
              <div className="flex items-start justify-between">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-sky-200 bg-sky-50 text-sky-700 shadow-sm">
                  <Users className="h-4 w-4" />
                </div>
                <ArrowRight className="h-4 w-4 text-slate-400 transition group-hover:translate-x-1 group-hover:text-sky-600" />
              </div>
              <div className="mt-4">
                <h3 className="text-sm font-bold text-slate-900">Suspect Intelligence</h3>
                <p className="mt-0.5 text-[11px] text-slate-500">Review kingpin rankings, associated aliases, and priors.</p>
              </div>
            </Link>

            <Link
              href="/alerts"
              className="group flex flex-col justify-between rounded-xl border border-slate-200/90 bg-slate-50/50 p-4 transition-all hover:bg-white hover:border-red-400 hover:shadow-sm"
            >
              <div className="flex items-start justify-between">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-700 shadow-sm">
                  <Bell className="h-4 w-4" />
                </div>
                <ArrowRight className="h-4 w-4 text-slate-400 transition group-hover:translate-x-1 group-hover:text-red-600" />
              </div>
              <div className="mt-4">
                <h3 className="text-sm font-bold text-slate-900">Alert Triage</h3>
                <p className="mt-0.5 text-[11px] text-slate-500">Evaluate anomalies, fraud signals, and risk queues.</p>
              </div>
            </Link>
          </div>
        </div>

        {/* ===================================================
            6. FOOTER
        =================================================== */}
        <footer className="flex flex-col items-center justify-between gap-2 border-t border-slate-200 pt-5 font-mono text-[11px] text-slate-500 md:flex-row pb-6">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-slate-400" />
            <span className="font-bold text-slate-700">CrimeNetX Platform</span>
            <span>// Operational Intelligence Workspace</span>
          </div>
          <span>TURNING FRAGMENTED CRIME DATA INTO CONNECTED INTELLIGENCE</span>
        </footer>

      </main>
    </div>
  );
}