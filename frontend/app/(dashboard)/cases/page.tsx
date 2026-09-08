"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { 
  Network, 
  MapPin, 
  FileText, 
  ExternalLink, 
  ShieldAlert, 
  Search, 
  FolderOpen, 
  UserCheck, 
  Plus, 
  ChevronRight, 
  AlertCircle, 
  X,
  User,
  Hash,
  SlidersHorizontal,
  Clock,
  Activity,
  Layers,
  Users,
  Shield,
  Radio,
  FileCheck
} from "lucide-react";
import { api, extractErrorMessage } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import type { CaseSummary, CaseStatus, CasePriority, Suspect } from "@shared/types";
import { CCTNSSyncModal } from "@/components/shared/CCTNSSyncModal";

const statusVariant: Record<CaseStatus, "info" | "warning" | "secondary" | "success" | "outline"> = {
  OPEN: "info",
  UNDER_INVESTIGATION: "warning",
  PENDING_REVIEW: "secondary",
  CLOSED: "success",
  COLD: "outline",
};

const priorityVariant: Record<CasePriority, "danger" | "warning" | "info" | "outline"> = {
  LOW: "outline",
  MEDIUM: "info",
  HIGH: "warning",
  CRITICAL: "danger",
};

type SearchFilterScope = "ALL" | "NAME" | "OFFICER" | "CASE_NO";

interface CaseDetailsPayload {
  stats?: {
    evidence?: number;
    entities?: number;
    transactions?: number;
    alerts?: number;
    nodes?: number;
    edges?: number;
    suspects?: number;
  };
  _count?: {
    evidence?: number;
    entities?: number;
    alerts?: number;
    suspects?: number;
    nodes?: number;
    edges?: number;
    transactions?: number;
  };
  evidence?: unknown[];
  entities?: unknown[];
  alerts?: unknown[];
  transactions?: unknown[];
  nodes?: unknown[];
  edges?: unknown[];
  suspects?: Suspect[];
}

export default function CasesPage() {
  const router = useRouter();

  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterScope, setFilterScope] = useState<SearchFilterScope>("ALL");
  const [error, setError] = useState<string | null>(null);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);

  // Inspection dossier detailed data
  const [caseDetails, setCaseDetails] = useState<CaseDetailsPayload | null>(null);
  const [suspectsList, setSuspectsList] = useState<Suspect[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);

  // 1. Fetch cases list
  const fetchCases = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<{ data: CaseSummary[]; total: number }>(
        `/cases?pageSize=100`
      );
      
      const list = Array.isArray(data) ? data : data?.data ?? [];
      setCases(list);
      setTotal(data?.total ?? list.length);
      setError(null);

      setSelectedCaseId((prev) => {
        if (prev && list.some((c) => c.id === prev)) return prev;
        return list[0]?.id ?? null;
      });
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchCases();
  }, [fetchCases]);

  // Active selected case
  const activeCase = useMemo(() => {
    return cases.find((c) => c.id === selectedCaseId) ?? cases[0] ?? null;
  }, [cases, selectedCaseId]);

  // 2. Fetch full case stats and suspect rankings whenever active case changes
  useEffect(() => {
    if (!activeCase?.id) return;
    let cancelled = false;
    setDetailsLoading(true);

    const loadInspectionData = async () => {
      try {
        // Attempt fetch of case detail payload
        let cRes;
        try {
          cRes = await api.get(`/cases/${activeCase.id}`);
        } catch {
          cRes = await api.get(`/case/${activeCase.id}`);
        }

        if (!cancelled && cRes?.data) {
          const raw = cRes.data.data ?? cRes.data;
          setCaseDetails(raw);

          if (Array.isArray(raw.suspects) && raw.suspects.length > 0) {
            setSuspectsList(raw.suspects);
            setDetailsLoading(false);
            return;
          }
        }

        // Secondary fallback to fetch suspects (like the main case detail page)
        const sRes = await api.get(`/suspects`);
        if (!cancelled && sRes?.data) {
          const rawSuspects = Array.isArray(sRes.data) ? sRes.data : sRes.data?.data ?? [];
          const sorted = [...rawSuspects].sort((a, b) => (b.kingpinScore ?? 0) - (a.kingpinScore ?? 0));
          setSuspectsList(sorted);
        }
      } catch (err) {
        console.error("Failed to fetch detailed case intelligence:", err);
      } finally {
        if (!cancelled) setDetailsLoading(false);
      }
    };

    void loadInspectionData();
    return () => {
      cancelled = true;
    };
  }, [activeCase?.id]);

  // Client-side search matching
  const filteredCases = useMemo(() => {
    if (!search.trim()) return cases;
    const q = search.toLowerCase().trim();

    return cases.filter((c) => {
      const caseNumber = (c.caseNumber || "").toLowerCase();
      const title = (c.title || "").toLowerCase();
      const description = (c.description || "").toLowerCase();
      const jurisdiction = (c.jurisdiction || "").toLowerCase();
      const officerName = (c.assignedInvestigator?.name || "").toLowerCase();

      switch (filterScope) {
        case "NAME":
          return title.includes(q) || description.includes(q);
        case "OFFICER":
          return officerName.includes(q);
        case "CASE_NO":
          return caseNumber.includes(q);
        case "ALL":
        default:
          return (
            caseNumber.includes(q) ||
            title.includes(q) ||
            description.includes(q) ||
            jurisdiction.includes(q) ||
            officerName.includes(q)
          );
      }
    });
  }, [cases, search, filterScope]);

  // Aggregate repository metrics
  const metrics = useMemo(() => {
    const critical = cases.filter((c) => c.priority === "CRITICAL").length;
    const high = cases.filter((c) => c.priority === "HIGH").length;
    const underInvestigation = cases.filter((c) => c.status === "UNDER_INVESTIGATION").length;
    return { critical, high, underInvestigation };
  }, [cases]);

  // Formatted Case Stats (Evidence, Entities, Transactions, Alerts, Nodes, Edges, Suspects)
  const caseStats = useMemo(() => {
    const s = caseDetails?.stats;
    const c = caseDetails?._count;
    return {
      evidence: s?.evidence ?? c?.evidence ?? caseDetails?.evidence?.length ?? 0,
      entities: s?.entities ?? c?.entities ?? caseDetails?.entities?.length ?? 0,
      transactions: s?.transactions ?? c?.transactions ?? caseDetails?.transactions?.length ?? 0,
      alerts: s?.alerts ?? c?.alerts ?? caseDetails?.alerts?.length ?? 1,
      nodes: s?.nodes ?? c?.nodes ?? caseDetails?.nodes?.length ?? 0,
      edges: s?.edges ?? c?.edges ?? caseDetails?.edges?.length ?? 0,
      suspects: s?.suspects ?? c?.suspects ?? suspectsList.length ?? 0,
    };
  }, [caseDetails, suspectsList]);

  return (
    <div className="space-y-6">
      {/* 1. COMMAND REPOSITORY HEADER */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between border-b border-slate-200/80 pb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="h-2 w-2 rounded-full bg-sky-600 animate-pulse" />
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
              Investigation Records Repository
            </span>
          </div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">
            Active Incidents &amp; Case Pipeline
          </h1>
          <p className="mt-0.5 text-xs text-slate-500 font-medium">
            {total} registered incident records scoped to your jurisdiction.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <CCTNSSyncModal onSyncComplete={() => void fetchCases()} />
          <Link href="/cases/new">
            <Button className="h-9 gap-1.5 font-bold shadow-sm">
              <Plus className="h-4 w-4" /> New Case
            </Button>
          </Link>
        </div>
      </div>

      {/* 2. REPOSITORY METRICS STRIP */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-200/80 bg-white p-3 shadow-xs">
          <span className="font-mono text-[9px] font-bold text-slate-400 uppercase tracking-widest block">Total Incidents</span>
          <span className="font-mono text-xl font-black text-slate-900 mt-1 block">{total}</span>
        </div>
        <div className="rounded-xl border border-red-200/80 bg-red-50/50 p-3 shadow-xs">
          <span className="font-mono text-[9px] font-bold text-red-700 uppercase tracking-widest block">Critical Priority</span>
          <span className="font-mono text-xl font-black text-red-700 mt-1 block">{metrics.critical}</span>
        </div>
        <div className="rounded-xl border border-amber-200/80 bg-amber-50/50 p-3 shadow-xs">
          <span className="font-mono text-[9px] font-bold text-amber-700 uppercase tracking-widest block">High Priority</span>
          <span className="font-mono text-xl font-black text-amber-700 mt-1 block">{metrics.high}</span>
        </div>
        <div className="rounded-xl border border-sky-200/80 bg-sky-50/50 p-3 shadow-xs">
          <span className="font-mono text-[9px] font-bold text-sky-700 uppercase tracking-widest block">Active Investigation</span>
          <span className="font-mono text-xl font-black text-sky-700 mt-1 block">{metrics.underInvestigation}</span>
        </div>
      </div>

      {/* 3. MULTI-FIELD SEARCH AND SCOPE FILTER BAR */}
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="relative flex-1 max-w-lg">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input 
            value={search} 
            onChange={(e) => setSearch(e.target.value)} 
            placeholder={
              filterScope === "NAME"
                ? "Search by suspect / person name..."
                : filterScope === "OFFICER"
                ? "Search by lead investigator / officer name..."
                : filterScope === "CASE_NO"
                ? "Search by case / FIR number..."
                : "Search by suspect name, officer, case #, title, phone..."
            }
            className="pl-9 pr-8 h-9.5 text-xs bg-white border-slate-200 font-medium placeholder:text-slate-400 shadow-xs" 
          />
          {search && (
            <button 
              type="button"
              onClick={() => setSearch("")} 
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
          <span className="font-mono text-[10px] text-slate-400 uppercase tracking-wider flex items-center gap-1 mr-1">
            <SlidersHorizontal className="h-3 w-3" /> Scope:
          </span>
          {[
            { id: "ALL", label: "All Fields" },
            { id: "NAME", label: "Suspect / Person", icon: User },
            { id: "OFFICER", label: "Officer", icon: UserCheck },
            { id: "CASE_NO", label: "Case #", icon: Hash },
          ].map((scope) => {
            const Icon = (scope as any).icon;
            const active = filterScope === scope.id;
            return (
              <button
                key={scope.id}
                type="button"
                onClick={() => setFilterScope(scope.id as SearchFilterScope)}
                className={`h-7 px-2.5 rounded-lg font-mono text-[10px] font-bold uppercase transition-colors flex items-center gap-1.5 shrink-0 ${
                  active
                    ? "bg-slate-900 text-white shadow-xs"
                    : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {Icon && <Icon className="h-2.5 w-2.5" />}
                {scope.label}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
          <span>{error}</span>
        </div>
      )}

      {/* 4. SPLIT-PANE WORKSPACE: QUEUE (LEFT) + FULL INSPECTOR DOSSIER (RIGHT) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        
        {/* LEFT COLUMN: INCIDENT QUEUE */}
        <div className="xl:col-span-6">
          <Card className="rounded-xl border border-slate-200/90 shadow-sm overflow-hidden bg-white">
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-slate-50/80 border-b border-slate-200/80">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="font-mono text-[10px] font-black uppercase tracking-wider text-slate-500 py-3">Case Identifier</TableHead>
                    <TableHead className="font-mono text-[10px] font-black uppercase tracking-wider text-slate-500 py-3">Incident &amp; Lead</TableHead>
                    <TableHead className="font-mono text-[10px] font-black uppercase tracking-wider text-slate-500 py-3 hidden md:table-cell">Jurisdiction</TableHead>
                    <TableHead className="font-mono text-[10px] font-black uppercase tracking-wider text-slate-500 py-3">Status</TableHead>
                    <TableHead className="font-mono text-[10px] font-black uppercase tracking-wider text-slate-500 py-3">Priority</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading &&
                    Array.from({ length: 6 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                        <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-20" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                      </TableRow>
                    ))}

                  {!loading &&
                    filteredCases.map((c) => {
                      const isSelected = activeCase?.id === c.id;
                      const isCCTNS = c.caseNumber?.toUpperCase().startsWith("CCTNS") || (c as any).source === "CCTNS";

                      return (
                        <TableRow 
                          key={c.id}
                          onClick={() => setSelectedCaseId(c.id)}
                          className={`cursor-pointer transition-colors ${
                            isSelected 
                              ? "bg-sky-50/70 border-l-4 border-l-sky-600" 
                              : "hover:bg-slate-50/80 border-l-4 border-l-transparent"
                          }`}
                        >
                          <TableCell className="py-3">
                            <span className="font-mono text-xs font-bold text-slate-900 block truncate">
                              {c.caseNumber}
                            </span>
                            <span className="font-mono text-[9px] text-slate-400 font-semibold block">
                              {isCCTNS ? "CCTNS SYNC" : "MANUAL FIR"}
                            </span>
                          </TableCell>

                          <TableCell className="py-3 max-w-[200px]">
                            <span className="font-semibold text-xs text-slate-800 line-clamp-1 block">
                              {c.title}
                            </span>
                            <div className="flex items-center gap-1 mt-0.5 text-[10px] text-slate-500">
                              <UserCheck className="h-3 w-3 text-slate-400 shrink-0" />
                              <span className="truncate">{c.assignedInvestigator?.name ?? "Unassigned"}</span>
                            </div>
                          </TableCell>

                          <TableCell className="py-3 hidden md:table-cell">
                            <span className="text-xs font-medium text-slate-600 flex items-center gap-1">
                              <MapPin className="h-3 w-3 text-slate-400 shrink-0" />
                              {c.jurisdiction}
                            </span>
                          </TableCell>

                          <TableCell className="py-3">
                            <Badge variant={statusVariant[c.status]} className="text-[10px] uppercase font-bold py-0.5">
                              {c.status.replace(/_/g, " ")}
                            </Badge>
                          </TableCell>

                          <TableCell className="py-3">
                            <Badge variant={priorityVariant[c.priority]} className="text-[10px] uppercase font-bold py-0.5">
                              {c.priority}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}

                  {!loading && filteredCases.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-12 text-center text-slate-400">
                        <FolderOpen className="h-8 w-8 mx-auto mb-2 text-slate-300" />
                        <span className="font-mono text-xs font-bold block uppercase text-slate-700">No Matching Incident Records</span>
                        <span className="text-[11px] mt-1 block text-slate-400">
                          {search ? `No records matched "${search}".` : "No cases registered."}
                        </span>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        {/* RIGHT COLUMN: ACTIVE CASE INSPECTION DOSSIER (ALL FIELDS FROM PAGE 1) */}
        <div className="xl:col-span-6 sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pr-1">
          {activeCase ? (
            <div className="relative rounded-xl border border-slate-200/90 bg-white p-5 shadow-sm space-y-4">
              {/* Corner Reticle Accents */}
              <span className="absolute top-0 left-0 h-2 w-2 border-t-2 border-l-2 border-slate-400 rounded-tl-[3px]" />
              <span className="absolute top-0 right-0 h-2 w-2 border-t-2 border-r-2 border-slate-400 rounded-tr-[3px]" />
              <span className="absolute bottom-0 left-0 h-2 w-2 border-b-2 border-l-2 border-slate-400 rounded-bl-[3px]" />
              <span className="absolute bottom-0 right-0 h-2 w-2 border-b-2 border-r-2 border-slate-400 rounded-br-[3px]" />

              {/* 1. Header: Identifier, Priority & Status Badges */}
              <div className="border-b border-slate-100 pb-3 flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                    <ShieldAlert className="h-3 w-3 text-sky-600" /> Incident Inspection Dossier
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="font-mono text-xs font-bold text-slate-500">{activeCase.caseNumber}</span>
                    <Badge variant={statusVariant[activeCase.status]} className="font-mono text-[10px] uppercase font-bold py-0">
                      {activeCase.status.replace(/_/g, " ")}
                    </Badge>
                    <Badge variant={priorityVariant[activeCase.priority]} className="font-mono text-[10px] uppercase font-bold py-0">
                      {activeCase.priority}
                    </Badge>
                  </div>
                  <h2 className="text-xl font-black text-slate-900 mt-1">{activeCase.title}</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {activeCase.jurisdiction} · Registered {formatDate(activeCase.createdAt)}
                  </p>
                </div>
              </div>

              {/* 2. Interactive Navigation Module Tabs (Overview, Network, Timeline, Evidence, Financial, Map, Dossier) */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-slate-100 font-mono text-[11px]">
                <Link href={`/cases/${activeCase.id}`}>
                  <button className="px-2.5 py-1 rounded border border-slate-200 bg-slate-50 text-slate-700 font-bold hover:bg-slate-100 transition">
                    Overview
                  </button>
                </Link>
                <Link href={`/cases/${activeCase.id}/network`}>
                  <button className="px-2.5 py-1 rounded border border-slate-200 bg-white text-slate-600 font-medium hover:bg-slate-50 transition">
                    Network
                  </button>
                </Link>
                <Link href={`/cases/${activeCase.id}/timeline`}>
                  <button className="px-2.5 py-1 rounded border border-slate-200 bg-white text-slate-600 font-medium hover:bg-slate-50 transition">
                    Timeline
                  </button>
                </Link>
                <Link href={`/cases/${activeCase.id}/evidence`}>
                  <button className="px-2.5 py-1 rounded border border-slate-200 bg-white text-slate-600 font-medium hover:bg-slate-50 transition">
                    Evidence
                  </button>
                </Link>
                <Link href={`/cases/${activeCase.id}/financial`}>
                  <button className="px-2.5 py-1 rounded border border-slate-200 bg-white text-slate-600 font-medium hover:bg-slate-50 transition">
                    Financial
                  </button>
                </Link>
                <Link href={`/cases/${activeCase.id}/map`}>
                  <button className="px-2.5 py-1 rounded border border-slate-200 bg-white text-slate-600 font-medium hover:bg-slate-50 transition">
                    Map
                  </button>
                </Link>
                {/* Dedicated Dossier Tab Redirect Button */}
                <Link href={`/cases/${activeCase.id}/dossier`}>
                  <button className="px-2.5 py-1 rounded border border-purple-300 bg-purple-50 text-purple-800 font-black hover:bg-purple-100 transition flex items-center gap-1 shadow-xs">
                    <FileText className="h-3 w-3 text-purple-600" /> Dossier
                  </button>
                </Link>
              </div>

              {/* 3. CASE STATS GRID (All 7 Metrics from First Page) */}
              <div>
                <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-slate-400 block mb-2">
                  Case Stats Telemetry
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-2.5">
                    <span className="font-mono text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Evidence</span>
                    <span className="font-mono text-lg font-black text-slate-800">{caseStats.evidence}</span>
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-2.5">
                    <span className="font-mono text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Entities</span>
                    <span className="font-mono text-lg font-black text-slate-800">{caseStats.entities}</span>
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-2.5">
                    <span className="font-mono text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Transactions</span>
                    <span className="font-mono text-lg font-black text-slate-800">{caseStats.transactions}</span>
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-2.5">
                    <span className="font-mono text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Alerts</span>
                    <span className="font-mono text-lg font-black text-slate-800">{caseStats.alerts}</span>
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-2.5">
                    <span className="font-mono text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Nodes</span>
                    <span className="font-mono text-lg font-black text-slate-800">{caseStats.nodes}</span>
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-2.5">
                    <span className="font-mono text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Edges</span>
                    <span className="font-mono text-lg font-black text-slate-800">{caseStats.edges}</span>
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-2.5 col-span-2">
                    <span className="font-mono text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Suspects</span>
                    <span className="font-mono text-lg font-black text-slate-800">{caseStats.suspects}</span>
                  </div>
                </div>
              </div>

              {/* 4. Description Field */}
              <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-3">
                <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-slate-400 block">Description</span>
                <p className="text-xs leading-relaxed text-slate-700 mt-1 font-medium">
                  {activeCase.description || "No description provided."}
                </p>
              </div>

              {/* 5. SUSPECTS (Ranked by Kingpin Score - Exactly as shown on Page 1) */}
              <div className="space-y-2 border-t border-slate-100 pt-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-mono text-[10px] font-black uppercase tracking-wider text-slate-800 block">
                      Suspects
                    </span>
                    <span className="text-[10px] text-slate-400 font-medium">Ranked by kingpin score</span>
                  </div>
                  <Link href={`/cases/${activeCase.id}`} className="font-mono text-[10px] text-sky-700 font-bold hover:underline">
                    View Full File →
                  </Link>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[220px] overflow-y-auto pr-1">
                  {detailsLoading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-12 w-full rounded-lg" />
                    ))
                  ) : suspectsList.length > 0 ? (
                    suspectsList.slice(0, 8).map((s) => {
                      const score = s.kingpinScore ?? 0;
                      const scoreColor =
                        score >= 70
                          ? "bg-red-500 text-white"
                          : score >= 40
                          ? "bg-amber-500 text-white"
                          : "bg-emerald-600 text-white";

                      return (
                        <Link key={s.id} href={`/suspects/${s.id}`} className="block">
                          <div className="flex items-center justify-between p-2 rounded-lg border border-slate-200/80 bg-white hover:border-sky-400 hover:shadow-xs transition">
                            <div className="min-w-0 pr-1">
                              <span className="text-xs font-bold text-slate-800 block truncate">{s.name}</span>
                              <span className="font-mono text-[9px] text-slate-400 block truncate">
                                {s.role ?? "BROKER"} {s.aliases?.length ? `· aka ${s.aliases.join(", ")}` : ""}
                              </span>
                            </div>
                            <span className={`font-mono text-[11px] font-black px-1.5 py-0.5 rounded shadow-xs shrink-0 ${scoreColor}`}>
                              {score}
                            </span>
                          </div>
                        </Link>
                      );
                    })
                  ) : (
                    <div className="col-span-2 text-center py-3 text-slate-400 text-xs font-mono">
                      No suspects correlated with this incident yet.
                    </div>
                  )}
                </div>
              </div>

              {/* 6. Lead Investigator & Commencement Date */}
              <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-xs">
                <div>
                  <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-slate-400 block">Lead Investigator</span>
                  <span className="font-bold text-slate-800 block mt-0.5 truncate">
                    {activeCase.assignedInvestigator?.name ?? "Unassigned"}
                  </span>
                  <span className="font-mono text-[10px] text-slate-400 block truncate">
                    {activeCase.assignedInvestigator?.email ?? "investigator@crimenetx.gov.in"}
                  </span>
                </div>
                <div>
                  <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-slate-400 block">Commencement Date</span>
                  <span className="font-mono text-[11px] font-bold text-slate-700 block mt-0.5">
                    {formatDate(activeCase.startDate || activeCase.createdAt)}
                  </span>
                  <span className="font-mono text-[10px] text-slate-400 block">
                    Synced: {formatDate(activeCase.updatedAt)}
                  </span>
                </div>
              </div>

              {/* 7. PROMINENT DOSSIER REDIRECT ACTION CARD */}
              <div 
                onClick={() => router.push(`/cases/${activeCase.id}/dossier`)}
                className="cursor-pointer rounded-lg border border-purple-200 bg-purple-50/70 p-3 hover:bg-purple-100/80 transition flex items-center justify-between group shadow-xs"
              >
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded bg-purple-600 text-white shadow-xs">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div>
                    <span className="font-mono text-xs font-bold text-purple-950 block group-hover:text-purple-700 transition">
                      Open Investigation Dossier
                    </span>
                    <span className="text-[10px] text-purple-700 font-medium">
                      Generate official FIR intelligence brief &amp; PDF record →
                    </span>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-purple-600 transition group-hover:translate-x-1" />
              </div>

              {/* 8. Tactical Dispatch Workspace */}
              <div className="border-t border-slate-100 pt-3">
                <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-slate-400 block mb-2">
                  Tactical Dispatch Workspace
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <Link href={`/cases/${activeCase.id}/network`} className="w-full">
                    <Button variant="outline" size="sm" className="w-full h-8 text-[11px] font-bold justify-center gap-1 border-slate-200 hover:border-sky-500 hover:text-sky-700">
                      <Network className="h-3 w-3 text-sky-600" /> Network
                    </Button>
                  </Link>

                  <Link href={`/cases/${activeCase.id}/map`} className="w-full">
                    <Button variant="outline" size="sm" className="w-full h-8 text-[11px] font-bold justify-center gap-1 border-slate-200 hover:border-amber-500 hover:text-amber-700">
                      <MapPin className="h-3 w-3 text-amber-600" /> Map
                    </Button>
                  </Link>

                  <Link href={`/cases/${activeCase.id}/dossier`} className="w-full">
                    <Button variant="outline" size="sm" className="w-full h-8 text-[11px] font-bold justify-center gap-1 border-purple-300 bg-purple-50 text-purple-800 hover:bg-purple-100">
                      <FileText className="h-3 w-3 text-purple-600" /> Dossier
                    </Button>
                  </Link>

                  <Link href={`/cases/${activeCase.id}`} className="w-full">
                    <Button size="sm" className="w-full h-8 text-[11px] font-bold justify-center gap-1 bg-slate-900 text-white hover:bg-slate-800">
                      <ExternalLink className="h-3 w-3" /> Full File
                    </Button>
                  </Link>
                </div>
              </div>

            </div>
          ) : (
            <div className="rounded-xl border border-slate-200/80 bg-white p-8 text-center text-slate-400 shadow-sm">
              <FolderOpen className="h-8 w-8 mx-auto mb-2 text-slate-300" />
              <p className="font-mono text-xs font-bold uppercase text-slate-600">Select an Incident Record</p>
              <p className="text-[11px] mt-1 text-slate-400">Click any row in the repository queue to inspect live case intelligence.</p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}