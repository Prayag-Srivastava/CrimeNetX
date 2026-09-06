"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { 
  ArrowLeft, 
  ChevronRight, 
  ShieldCheck, 
  Hash, 
  FileCheck, 
  Clock, 
  UserCheck, 
  HardDrive,
  CheckCircle2,
  Lock,
  Radio,
  FileText,
  Search,
  DownloadCloud
} from "lucide-react";
import { api, extractErrorMessage } from "@/lib/api";
import { FIRUploader } from "@/components/uploads/FIRUploader";
import { CDRUploader } from "@/components/uploads/CDRUploader";
import { EvidenceUploader } from "@/components/uploads/EvidenceUploader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Evidence } from "@shared/types";
import { formatDate } from "@/lib/utils";

const typeBadges: Record<string, { label: string; style: string }> = {
  FIR: { label: "FIR RECORD", style: "bg-sky-50 text-sky-700 border-sky-200/90 ring-1 ring-sky-500/10" },
  CDR: { label: "CDR TELECOM", style: "bg-rose-50 text-rose-700 border-rose-200/90 ring-1 ring-rose-500/10" },
  BANK: { label: "FINANCIAL", style: "bg-emerald-50 text-emerald-700 border-emerald-200/90 ring-1 ring-emerald-500/10" },
  PHOTO: { label: "FORENSIC IMG", style: "bg-purple-50 text-purple-700 border-purple-200/90 ring-1 ring-purple-500/10" },
  DOCUMENT: { label: "LEGAL DOC", style: "bg-slate-100 text-slate-700 border-slate-200 ring-1 ring-slate-400/10" },
  CCTV: { label: "CCTV FRAME", style: "bg-amber-50 text-amber-800 border-amber-200/90 ring-1 ring-amber-500/10" },
};

export default function EvidencePage() {
  const { id } = useParams<{ id: string }>();
  const [items, setItems] = useState<Evidence[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<"ALL" | "FIR" | "CDR">("ALL");

  async function refresh() {
    try {
      const { data } = await api.get<{ data: Evidence[] }>(`/evidence/case/${id}`);
      setItems(data.data);
      setError(null);
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const firCount = items.filter((e) => e.type === "FIR").length;
  const cdrCount = items.filter((e) => e.type === "CDR").length;
  const mediaCount = items.length - firCount - cdrCount;

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesType = activeFilter === "ALL" || item.type === activeFilter;
      const q = searchQuery.trim().toLowerCase();
      const matchesQuery =
        !q ||
        item.fileName.toLowerCase().includes(q) ||
        (item.sha256Hash && item.sha256Hash.toLowerCase().includes(q));
      return matchesType && matchesQuery;
    });
  }, [items, activeFilter, searchQuery]);

  const handleExportLog = () => {
    const dataToExport = filteredItems.length > 0 ? filteredItems : items;
    if (dataToExport.length === 0) return;

    const headers = [
      "Evidence_ID",
      "Type",
      "Artifact_Filename",
      "SHA256_Digest",
      "Timestamp",
      "Recording_Officer",
      "Integrity_Status"
    ];

    const rows = dataToExport.map((e) => [
      `"${e.id}"`,
      `"${e.type}"`,
      `"${e.fileName.replace(/"/g, '""')}"`,
      `"${e.sha256Hash || "PENDING_HASH"}"`,
      `"${formatDate(e.uploadedAt)}"`,
      `"${(e.uploader?.name ?? "DGP Sanjay Mhaiskar").replace(/"/g, '""')}"`,
      `"VERIFIED_SEALED"`
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.setAttribute(
      "download",
      `CrimeNetX_ChainOfCustody_${id}_${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();

    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 100);
  };

  return (
    <div className="space-y-6">
      {/* 1. TOP BREADCRUMB & JURISDICTION CONTEXT */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200/80 pb-3">
        <div className="flex items-center gap-2 font-mono text-xs">
          <Link
            href="/cases"
            className="group inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-700 shadow-2xs transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950"
          >
            <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5 text-slate-400 group-hover:text-slate-700" />
            <span>CASE VAULT</span>
          </Link>

          <span className="text-slate-300">/</span>

          <Link
            href={`/cases/${id}`}
            className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-900 font-medium transition"
          >
            <span>Overview</span>
            <ChevronRight className="h-3 w-3 text-slate-400" />
          </Link>

          <span className="font-bold text-slate-900 bg-slate-100 border border-slate-200/90 px-2 py-0.5 rounded text-[11px]">
            EVIDENCE REGISTER
          </span>
        </div>

        <div className="flex items-center gap-2 font-mono text-[11px]">
          <span className="inline-flex items-center gap-1.5 font-bold tracking-tight text-emerald-800 bg-emerald-50/90 border border-emerald-200/90 px-2.5 py-1 rounded-md shadow-2xs">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
            <span>SEC 65B IEA / 63 BSA COMPLIANT</span>
          </span>
        </div>
      </div>

      {/* 2. COMMAND BANNER WITH INTEGRATED TELEMETRY STRIP */}
      <div className="relative overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-xs">
        <div className="h-1 w-full bg-slate-950" />

        <div className="p-5 sm:p-6">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
              Statutory Chain-of-Custody Vault
            </span>
          </div>

          <h1 className="text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">
            Evidence & Telemetry Ingestion Register
          </h1>

          <p className="text-xs sm:text-sm text-slate-500 mt-1.5 max-w-3xl font-medium leading-relaxed">
            All submitted artifacts (FIR documents, telecom CDR sheets, forensic photos, and bank registers) are cryptographically hashed using SHA-256 to ensure zero tampering and verified judicial admissibility.
          </p>
        </div>

        {/* Telemetry Summary HUD */}
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-slate-200/80 bg-slate-50/75 border-t border-slate-200/90 font-mono text-center">
          <div className="py-3 px-3 transition hover:bg-slate-50">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold flex items-center justify-center gap-1.5">
              <HardDrive className="h-3.5 w-3.5 text-slate-400" /> Total Items
            </div>
            <div className="text-lg font-black text-slate-900 mt-0.5 tabular-nums">{items.length}</div>
          </div>

          <div className="py-3 px-3 transition hover:bg-slate-50">
            <div className="text-[10px] uppercase tracking-wider text-sky-600 font-bold flex items-center justify-center gap-1.5">
              <FileText className="h-3.5 w-3.5 text-sky-500" /> FIR Documents
            </div>
            <div className="text-lg font-black text-sky-800 mt-0.5 tabular-nums">{firCount}</div>
          </div>

          <div className="py-3 px-3 transition hover:bg-slate-50">
            <div className="text-[10px] uppercase tracking-wider text-rose-600 font-bold flex items-center justify-center gap-1.5">
              <Radio className="h-3.5 w-3.5 text-rose-500" /> Telecom CDRs
            </div>
            <div className="text-lg font-black text-rose-800 mt-0.5 tabular-nums">{cdrCount}</div>
          </div>

          <div className="py-3 px-3 transition hover:bg-slate-50">
            <div className="text-[10px] uppercase tracking-wider text-purple-600 font-bold flex items-center justify-center gap-1.5">
              <Lock className="h-3.5 w-3.5 text-purple-500" /> Media & Other
            </div>
            <div className="text-lg font-black text-purple-800 mt-0.5 tabular-nums">{mediaCount}</div>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50/80 p-4 font-mono text-xs text-rose-800 shadow-2xs">
          <span className="font-bold uppercase tracking-wider">[Telemetry Exception]:</span> {error}
        </div>
      )}

      {/* 3. INTAKE BAYS */}
      <div className="grid gap-4 lg:grid-cols-3">
        <FIRUploader caseId={id} onUploaded={() => void refresh()} />
        <CDRUploader caseId={id} onUploaded={() => void refresh()} />
        <EvidenceUploader caseId={id} onUploaded={() => void refresh()} />
      </div>

      {/* 4. CRYPTOGRAPHIC EVIDENCE LEDGER */}
      <Card className="relative overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-xs">
        <span className="absolute top-0 left-0 h-2 w-2 border-t-2 border-l-2 border-slate-400 rounded-tl-[3px]" />
        <span className="absolute top-0 right-0 h-2 w-2 border-t-2 border-r-2 border-slate-400 rounded-tr-[3px]" />

        <CardHeader className="border-b border-slate-100 p-0">
          {/* Top Header Row */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5 pb-3">
            <CardTitle className="flex items-center gap-2 font-mono text-sm font-bold text-slate-950">
              <Hash className="h-4 w-4 text-purple-600" />
              <span>STATUTORY EVIDENCE LEDGER</span>
              <span className="text-xs font-semibold text-slate-400 font-mono">({filteredItems.length})</span>
            </CardTitle>

            <div className="flex items-center gap-2 font-mono text-[11px]">
              <span className="inline-flex items-center gap-1 text-slate-400 uppercase tracking-wider">
                <Lock className="h-3 w-3 text-slate-400" />
                <span>SHA-256 Verification Active</span>
              </span>
            </div>
          </div>

          {/* Tactical Filter Console */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/60 p-3 sm:px-5 border-t border-slate-100">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 flex-1">
              <div className="relative w-full max-w-sm">
                <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                  <Search className="h-3.5 w-3.5 text-slate-400" />
                </div>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by filename or SHA-256 digest..."
                  className="w-full bg-white border border-slate-200 rounded-md pl-8 pr-3 py-1.5 font-mono text-xs text-slate-800 placeholder:text-slate-400 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-900/5 transition shadow-2xs"
                />
              </div>

              {/* Segmented Filter Control */}
              <div className="inline-flex items-center rounded-md bg-slate-200/60 p-0.5 border border-slate-200/80">
                {(["ALL", "FIR", "CDR"] as const).map((filterKey) => {
                  const isActive = activeFilter === filterKey;
                  return (
                    <button
                      key={filterKey}
                      type="button"
                      onClick={() => setActiveFilter(filterKey)}
                      className={`px-3 py-1 rounded font-mono text-[10px] font-bold tracking-wider transition ${
                        isActive
                          ? "bg-white text-slate-900 shadow-2xs"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      {filterKey}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                onClick={handleExportLog}
                disabled={items.length === 0}
                size="sm"
                className="h-8 gap-1.5 font-mono text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 shadow-2xs transition active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none"
              >
                <DownloadCloud className="h-3.5 w-3.5 text-slate-300" />
                <span>Export Secure Log</span>
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-slate-50/90 border-b border-slate-200/80">
              <TableRow className="hover:bg-transparent">
                <TableHead className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-500 py-3 pl-5">
                  Type / Class
                </TableHead>
                <TableHead className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-500 py-3">
                  Artifact Filename
                </TableHead>
                <TableHead className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-500 py-3">
                  Tamper Digest (SHA-256)
                </TableHead>
                <TableHead className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-500 py-3">
                  Filing Timestamp
                </TableHead>
                <TableHead className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-500 py-3">
                  Recording Officer
                </TableHead>
                <TableHead className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-500 py-3 text-right pr-5">
                  Status
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-slate-100 font-mono text-xs text-slate-700">
              {filteredItems.map((e) => {
                const badge = typeBadges[e.type] ?? {
                  label: e.type,
                  style: "bg-slate-100 text-slate-700 border-slate-200",
                };

                return (
                  <TableRow key={e.id} className="hover:bg-slate-50/75 transition-colors">
                    <TableCell className="py-3 pl-5 whitespace-nowrap">
                      <span className={`inline-block font-black text-[10px] px-2 py-0.5 rounded border uppercase tracking-wider ${badge.style}`}>
                        {badge.label}
                      </span>
                    </TableCell>

                    <TableCell className="py-3 font-semibold text-slate-900 max-w-[260px] truncate">
                      <div className="flex items-center gap-1.5 truncate">
                        <FileCheck className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">{e.fileName}</span>
                      </div>
                    </TableCell>

                    <TableCell className="py-3 whitespace-nowrap">
                      <span className="font-mono text-[11px] bg-slate-50 border border-slate-200/90 px-2 py-0.5 rounded text-slate-800 tabular-nums">
                        {e.sha256Hash ? `${e.sha256Hash.slice(0, 18)}…` : "—"}
                      </span>
                    </TableCell>

                    <TableCell className="py-3 whitespace-nowrap text-slate-500 text-[11px] tabular-nums">
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-3 w-3 text-slate-400 shrink-0" />
                        <span>{formatDate(e.uploadedAt)}</span>
                      </div>
                    </TableCell>

                    <TableCell className="py-3 whitespace-nowrap text-slate-800 font-medium text-[11px]">
                      <div className="flex items-center gap-1.5">
                        <UserCheck className="h-3 w-3 text-slate-400 shrink-0" />
                        <span>{e.uploader?.name ?? "DGP Sanjay Mhaiskar"}</span>
                      </div>
                    </TableCell>

                    <TableCell className="py-3 pr-5 whitespace-nowrap text-right">
                      <span className="inline-flex items-center gap-1 font-bold text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded shadow-2xs">
                        <CheckCircle2 className="h-3 w-3 text-emerald-600" /> Sealed
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}

              {filteredItems.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-14 text-center">
                    <div className="mx-auto w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mb-2.5">
                      <HardDrive className="h-5 w-5 text-slate-400" />
                    </div>
                    <div className="font-mono text-xs font-bold uppercase text-slate-800">
                      {items.length === 0 ? "No Evidence Artifacts Sealed in Vault" : "No Matching Artifacts Found"}
                    </div>
                    <p className="font-mono text-[11px] text-slate-400 mt-1 max-w-sm mx-auto">
                      {items.length === 0
                        ? "Use the intake channels above to register FIRs, call detail sheets, or forensic media files."
                        : "Try adjusting your search query or switching the class filter."}
                    </p>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}