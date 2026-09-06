"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCase } from "@/hooks/useCase";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useCaseStore } from "@/store/caseStore";
import { useEffect } from "react";
import { formatDate } from "@/lib/utils";
import type { CaseStatus, CasePriority } from "@shared/types";
import { 
  ShieldAlert, 
  Users, 
  FileText, 
  ExternalLink, 
  ChevronRight,
  Fingerprint
} from "lucide-react";

const statusColors: Record<CaseStatus, { text: string; bg: string; border: string }> = {
  OPEN: { text: "text-sky-800", bg: "bg-sky-50", border: "border-sky-200" },
  UNDER_INVESTIGATION: { text: "text-amber-800", bg: "bg-amber-50", border: "border-amber-200" },
  PENDING_REVIEW: { text: "text-purple-800", bg: "bg-purple-50", border: "border-purple-200" },
  CLOSED: { text: "text-emerald-800", bg: "bg-emerald-50", border: "border-emerald-200" },
  COLD: { text: "text-slate-600", bg: "bg-slate-100", border: "border-slate-300" },
};

const priorityAccents: Record<CasePriority, { bar: string; badge: string; border: string }> = {
  CRITICAL: { bar: "bg-rose-600", badge: "bg-rose-50 text-rose-700 border-rose-200", border: "border-rose-300" },
  HIGH: { bar: "bg-amber-500", badge: "bg-amber-50 text-amber-800 border-amber-200", border: "border-amber-300" },
  MEDIUM: { bar: "bg-sky-500", badge: "bg-sky-50 text-sky-700 border-sky-200", border: "border-sky-300" },
  LOW: { bar: "bg-slate-400", badge: "bg-slate-50 text-slate-600 border-slate-200", border: "border-slate-300" },
};

const TABS = [
  { href: "", label: "Overview" },
  { href: "/network", label: "Network" },
  { href: "/timeline", label: "Timeline" },
  { href: "/evidence", label: "Evidence" },
  { href: "/financial", label: "Financial" },
  { href: "/map", label: "Map" },
  { href: "/dossier", label: "Dossier", tag: "PDF" },
];

export default function CaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { caseData, stats, suspects, loading, error } = useCase(id);
  const setActiveCaseId = useCaseStore((s) => s.setActiveCaseId);

  useEffect(() => {
    setActiveCaseId(id);
    return () => setActiveCaseId(null);
  }, [id, setActiveCaseId]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72 rounded-lg" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 font-mono text-xs text-rose-800">
        <span className="font-bold uppercase tracking-wider">[Telemetry Fault]:</span> {error}
      </div>
    );
  }

  if (!caseData) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-12 text-center font-mono text-xs text-slate-500">
        NO CASE RECORD FOUND FOR SPECIFIED IDENTIFIER.
      </div>
    );
  }

  const priorityStyle = priorityAccents[caseData.priority] ?? priorityAccents.MEDIUM;
  const statusStyle = statusColors[caseData.status] ?? statusColors.OPEN;

  return (
    <div className="space-y-4">
      {/* COMMAND HEADER PANEL */}
      <div className="relative overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-xs">
        {/* Priority Status Line */}
        <div className={`h-1 w-full ${priorityStyle.bar}`} />

        <div className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-2 font-mono text-xs">
              <span className="inline-flex items-center gap-1.5 font-black uppercase text-slate-400 text-[10px] tracking-widest mr-1">
                <ShieldAlert className="h-3.5 w-3.5 text-slate-500" />
                INCIDENT INSPECTION DOSSIER
              </span>
              <span className="font-bold text-slate-900 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded">
                {caseData.caseNumber}
              </span>
              <span className={`font-bold uppercase text-[10px] px-2 py-0.5 rounded border ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}>
                {caseData.status.replace(/_/g, " ")}
              </span>
              <span className={`font-bold uppercase text-[10px] px-2 py-0.5 rounded border ${priorityStyle.badge}`}>
                {caseData.priority} PRIORITY
              </span>
            </div>

            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
              Registered: {formatDate(caseData.createdAt)}
            </span>
          </div>

          <h1 className="text-2xl font-black tracking-tight text-slate-900">
            {caseData.title || "Untitled Incident Record"}
          </h1>

          <p className="font-mono text-xs text-slate-500 mt-1 flex items-center gap-1.5">
            <span>Jurisdiction:</span>
            <span className="font-semibold text-slate-800">{caseData.jurisdiction || "State Cyber Cell"}</span>
          </p>
        </div>

        {/* INTEGRATED SUB-NAVIGATION TABS */}
        <div className="flex items-center gap-1 border-t border-b border-slate-200/80 px-4 bg-slate-50/50 overflow-x-auto">
          {TABS.map((t) => {
            const isActive = t.href === "";
            return (
              <Link
                key={t.href}
                href={`/cases/${id}${t.href}`}
                className={`group flex items-center gap-1.5 py-2.5 px-3 font-mono text-xs font-bold border-b-2 transition -mb-[1px] whitespace-nowrap ${
                  isActive
                    ? "border-slate-900 text-slate-950 bg-white shadow-xs rounded-t"
                    : "border-transparent text-slate-500 hover:text-slate-900 hover:border-slate-300"
                }`}
              >
                <span>{t.label}</span>
                {t.tag && (
                  <span className="text-[9px] font-black px-1.5 py-0.2 rounded bg-purple-100 text-purple-700">
                    {t.tag}
                  </span>
                )}
              </Link>
            );
          })}
        </div>

        {/* DENSE TELEMETRY HUD RIBBON */}
        {stats && Object.keys(stats).length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 divide-x divide-y sm:divide-y-0 divide-slate-200/80 bg-slate-50/80 border-b border-slate-200/80 font-mono text-center">
            {Object.entries(stats).map(([k, v]) => {
              const isAlert = k.toLowerCase().includes("alert");
              return (
                <div key={k} className={`py-2 px-2.5 ${isAlert && Number(v) > 0 ? "bg-rose-50/60" : ""}`}>
                  <div className={`text-[9px] uppercase tracking-wider font-semibold ${isAlert && Number(v) > 0 ? "text-rose-600" : "text-slate-400"}`}>
                    {k.replace(/([A-Z])/g, " $1")}
                  </div>
                  <div className={`text-base font-black ${isAlert && Number(v) > 0 ? "text-rose-700" : "text-slate-800"}`}>
                    {v as number}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* LOWER INVESTIGATION WORKBENCH */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* LEFT COLUMN: NARRATIVE & SUSPECT PROFILES */}
        <div className="space-y-4 lg:col-span-2">
          {/* Incident Narrative */}
          <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs">
            <div className="flex items-center gap-2 mb-2">
              <FileText className="h-4 w-4 text-slate-500" />
              <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-slate-700">
                Statutory Incident Description
              </h2>
            </div>
            <p className="text-xs leading-relaxed text-slate-600 font-sans">
              {caseData.description || "No formal narrative provided for this case file."}
            </p>
          </div>

          {/* Suspect Intelligence Roster */}
          <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs">
            <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2.5">
              <div>
                <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                  <Users className="h-4 w-4 text-purple-600" />
                  Identified Syndicate Members & Suspects
                </h2>
                <p className="font-mono text-[10px] text-slate-400 mt-0.5">
                  Ranked by Network Centrality & Threat Index
                </p>
              </div>
              <span className="font-mono text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                {suspects.length} Linked
              </span>
            </div>

            {suspects.length === 0 ? (
              <div className="p-6 text-center font-mono text-xs text-slate-400">
                No syndicate entities linked to this incident.
              </div>
            ) : (
              <div className="grid gap-2.5 sm:grid-cols-2">
                {suspects.slice(0, 8).map((s) => {
                  const score = s.kingpinScore ?? 0;
                  const isHigh = score >= 70;
                  const isMed = score >= 40 && score < 70;

                  return (
                    <Link
                      key={s.id}
                      href={`/suspects/${s.id}`}
                      className="group relative flex flex-col justify-between rounded-lg border border-slate-200/80 bg-white p-3 shadow-2xs hover:border-slate-400 hover:shadow-xs transition"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <Fingerprint className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                            <span className="font-mono text-xs font-bold text-slate-900 truncate group-hover:text-purple-700 transition-colors">
                              {s.name}
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] font-mono text-slate-500">
                            <span className="font-bold text-slate-700 bg-slate-100 border border-slate-200 px-1.5 py-0.2 rounded uppercase">
                              {s.role || "OPERATOR"}
                            </span>
                            {s.aliases?.length > 0 && (
                              <span className="truncate max-w-[140px] text-slate-400">
                                aka {s.aliases.join(", ")}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Threat Centrality Badge */}
                        <div className="text-right shrink-0">
                          <span
                            className={`font-mono text-xs font-black px-1.5 py-0.5 rounded border ${
                              isHigh
                                ? "bg-rose-50 border-rose-200 text-rose-700"
                                : isMed
                                ? "bg-amber-50 border-amber-200 text-amber-700"
                                : "bg-emerald-50 border-emerald-200 text-emerald-700"
                            }`}
                          >
                            {score.toFixed(1)}%
                          </span>
                        </div>
                      </div>

                      {/* Micro Threat Metric Meter */}
                      <div className="mt-3 h-1 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${
                            isHigh ? "bg-rose-600" : isMed ? "bg-amber-500" : "bg-emerald-500"
                          }`}
                          style={{ width: `${Math.min(score, 100)}%` }}
                        />
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: QUICK METADATA & ACTIONS */}
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs">
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-slate-800 mb-3 border-b border-slate-100 pb-2">
              Chain of Custody
            </h3>
            <div className="space-y-2.5 font-mono text-xs">
              <div className="flex items-center justify-between text-slate-600">
                <span className="text-slate-400">Case ID:</span>
                <span className="font-bold text-slate-800">{caseData.id.slice(0, 12)}…</span>
              </div>
              <div className="flex items-center justify-between text-slate-600">
                <span className="text-slate-400">Filing Node:</span>
                <span className="font-semibold text-slate-800">{caseData.jurisdiction}</span>
              </div>
              <div className="flex items-center justify-between text-slate-600">
                <span className="text-slate-400">Security Grade:</span>
                <span className="font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.2 rounded text-[10px]">
                  RESTRICTED
                </span>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100">
              <Link
                href={`/cases/${id}/dossier`}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 font-mono text-xs font-bold text-white shadow-xs hover:bg-slate-800 transition"
              >
                <span>Compile Official Dossier</span>
                <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}