"use client";

import { useState } from "react";
import Link from "next/link";
import { 
  GitCompare, 
  Search, 
  ShieldCheck, 
  FileText, 
  ArrowUpRight, 
  Sparkles, 
  Hash, 
  Layers, 
  RotateCcw,
  CheckCircle2,
  Tag
} from "lucide-react";
import { aiApi, extractErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";

type CrossReferenceMatch = {
  case_id: string;
  case_number: string;
  score: number;
  matched_entities: string[];
  matched_reason: string;
};

export default function CrossReferencePage() {
  const [caseId, setCaseId] = useState("");
  const [firText, setFirText] = useState("");
  const [matches, setMatches] = useState<CrossReferenceMatch[]>([]);
  const [busy, setBusy] = useState(false);

  const { toast, view } = useToast();

  async function run() {
    if (!firText.trim()) {
      toast(
        "FIR Narrative Required",
        "Paste the case facts or incident description to cross-reference.",
        "destructive"
      );
      return;
    }

    setBusy(true);
    setMatches([]);

    try {
      const { data } = await aiApi.post<{
        case_id: string;
        matches: CrossReferenceMatch[];
      }>(`/vector/cross-reference/${caseId || "query"}`, {
        case_id: caseId || "query",
        fir_text: firText,
        entities: [],
      });

      const results = Array.isArray(data.matches) ? data.matches : [];
      setMatches(results);

      toast(
        "Cross-Reference Complete",
        `${results.length} linked historical cases discovered via vector similarity.`
      );
    } catch (err) {
      console.error("Cross-reference failed:", err);
      toast(
        "Search Failed",
        extractErrorMessage(err),
        "destructive"
      );
    } finally {
      setBusy(false);
    }
  }

  const handleReset = () => {
    setCaseId("");
    setFirText("");
    setMatches([]);
  };

  return (
    <div className="space-y-5">
      {/* 1. TOP CLASSIFICATION & CONTEXT STRIP */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="font-bold text-slate-900 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded text-[11px] tracking-wider uppercase">
            INTELLIGENCE WORKBENCH
          </span>
          <span className="text-slate-300">/</span>
          <span className="text-slate-500 font-semibold">CROSS-CASE PATTERN MATCHING</span>
        </div>

        <div className="flex items-center gap-2 font-mono text-[11px]">
          <span className="inline-flex items-center gap-1.5 font-bold tracking-tight text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-md shadow-2xs">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
            <span>CHROMA VECTOR ENGINE // SP+ AUTHORIZED</span>
          </span>
        </div>
      </div>

      {/* 2. COMMAND HEADER BANNER */}
      <div className="relative overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-xs">
        <div className="h-1 w-full bg-slate-950" />

        <div className="p-5 sm:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-600" />
              </span>
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                Semantic Modus Operandi & Entity Correlation
              </span>
            </div>

            <h1 className="text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">
              Multi-Case Cross-Reference
            </h1>

            <p className="text-xs sm:text-sm text-slate-500 mt-1.5 max-w-3xl font-medium leading-relaxed">
              High-dimensional vector similarity across historical FIR records. Uncovers linked criminal syndicates, burner telecom IDs, duplicate vehicle plates, and repeating MO structures.
            </p>
          </div>
        </div>
      </div>

      {/* 3. QUERY INGESTION BAY */}
      <Card className="rounded-xl border border-slate-200/90 bg-white shadow-xs overflow-hidden">
        <CardHeader className="border-b border-slate-100 py-3.5 px-4 sm:px-5">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-wider text-slate-900">
              <FileText className="h-4 w-4 text-purple-600" />
              <span>Query Narrative & Parameters</span>
            </CardTitle>
            <span className="font-mono text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
              Cosine Similarity Search
            </span>
          </div>
        </CardHeader>

        <CardContent className="p-4 sm:p-5 space-y-4">
          {/* Case Identifier Field */}
          <div className="space-y-1.5">
            <label className="font-mono text-[11px] font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
              <Hash className="h-3 w-3 text-slate-400" />
              <span>Originating Case Identifier (Optional)</span>
            </label>
            <input
              type="text"
              value={caseId}
              onChange={(e) => setCaseId(e.target.value)}
              placeholder="e.g. PUN-2024-0118 or leave blank for ad-hoc query"
              className="w-full max-w-md rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-1.5 font-mono text-xs text-slate-800 placeholder:text-slate-400 outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition"
            />
          </div>

          {/* Narrative Text Area */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="font-mono text-[11px] font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                <Layers className="h-3 w-3 text-slate-400" />
                <span>FIR Incident Narrative / Fact Pattern</span>
              </label>
              <span className="font-mono text-[10px] text-slate-400">
                {firText.length} characters logged
              </span>
            </div>
            <textarea
              rows={5}
              value={firText}
              onChange={(e) => setFirText(e.target.value)}
              placeholder="Paste FIR narrative, suspect confessions, vehicle details, bank account mentions, or specific modus operandi to cross-reference against indexed database..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50/50 p-3.5 font-sans text-xs text-slate-800 placeholder:text-slate-400 leading-relaxed outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition shadow-2xs"
            />
          </div>

          {/* Action Row */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={handleReset}
              disabled={busy || (!caseId && !firText)}
              className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-slate-500 hover:text-slate-900 transition disabled:opacity-30 disabled:pointer-events-none"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Clear Inputs</span>
            </button>

            <Button
              onClick={() => void run()}
              disabled={busy || !firText.trim()}
              className="h-9 px-5 gap-2 font-mono text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 shadow-2xs active:scale-[0.98] transition disabled:opacity-40"
            >
              {busy ? (
                <span>Executing Vector Scan...</span>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5 text-purple-400" />
                  <span>Run Cross-Reference</span>
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 4. CORRELATION RESULTS LEDGER */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <GitCompare className="h-4 w-4 text-slate-700" />
            <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-slate-900">
              Vector Similarity Discoveries ({matches.length})
            </h2>
          </div>
          {matches.length > 0 && (
            <span className="font-mono text-[10px] text-slate-400 uppercase tracking-wider">
              Ranked by Semantic Confidence
            </span>
          )}
        </div>

        {/* Matches Grid / List */}
        <div className="space-y-2.5">
          {matches.map((m) => {
            const score = Number(m.score) || 0;
            const isHigh = score >= 70;
            const isMed = score >= 40 && score < 70;

            return (
              <div
                key={m.case_id}
                className="group rounded-xl border border-slate-200 bg-white p-4 shadow-2xs hover:border-slate-300 hover:shadow-xs transition"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  {/* Left Column: Case Number, Explanation & Entities */}
                  <div className="space-y-2 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/cases/${m.case_id}`}
                        className="font-mono text-sm font-bold text-slate-950 hover:text-purple-700 transition inline-flex items-center gap-1"
                      >
                        <span>{m.case_number || m.case_id}</span>
                        <ArrowUpRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-purple-700 transition-colors" />
                      </Link>

                      <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 uppercase">
                        Historical Record
                      </span>
                    </div>

                    {/* Matched Rationale Narrative */}
                    <p className="text-xs text-slate-600 leading-relaxed font-sans">
                      {m.matched_reason}
                    </p>

                    {/* Entities Pills */}
                    {m.matched_entities?.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        <span className="inline-flex items-center gap-1 text-[10px] font-mono text-slate-400 uppercase font-bold mr-1">
                          <Tag className="h-2.5 w-2.5" />
                          <span>Overlapping Nodes:</span>
                        </span>
                        {m.matched_entities.map((entity) => (
                          <span
                            key={entity}
                            className="inline-flex items-center rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-700"
                          >
                            {entity}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Right Column: Similarity Score */}
                  <div className="shrink-0 flex sm:flex-col items-end justify-between sm:justify-start gap-2">
                    <span
                      className={`inline-block font-mono text-xs font-black px-2.5 py-1 rounded border tabular-nums shadow-2xs ${
                        isHigh
                          ? "bg-rose-50 border-rose-200 text-rose-700"
                          : isMed
                          ? "bg-amber-50 border-amber-200 text-amber-800"
                          : "bg-emerald-50 border-emerald-200 text-emerald-700"
                      }`}
                    >
                      {score.toFixed(1)}% Match
                    </span>

                    <span className="font-mono text-[10px] text-slate-400 hidden sm:inline">
                      {isHigh ? "Critical Link" : isMed ? "Probable Link" : "Contextual"}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Empty State */}
          {!busy && matches.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-200 bg-white p-12 text-center shadow-2xs">
              <div className="mx-auto w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mb-2.5">
                <Search className="h-5 w-5 text-slate-400" />
              </div>
              <div className="font-mono text-xs font-bold uppercase text-slate-800">
                Awaiting Vector Query Input
              </div>
              <p className="font-mono text-[11px] text-slate-400 mt-1 max-w-sm mx-auto">
                Paste an incident description or FIR fact pattern above and click "Run Cross-Reference" to surface linked records.
              </p>
            </div>
          )}
        </div>
      </div>

      {view}
    </div>
  );
}