"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { 
  ArrowLeft, 
  FileText, 
  Zap, 
  ShieldAlert, 
  ExternalLink, 
  CheckCircle2, 
  Clock, 
  ChevronRight,
  Globe
} from "lucide-react";
import { api, extractErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/utils";

interface DossierRow {
  id: string;
  caseId: string;
  s3Url: string;
  localPath: string;
  sha256Hash: string;
  pageCount: number;
  generatedAt: string;
  language?: string;
}

interface CaseHeaderInfo {
  id: string;
  caseNumber: string;
  title: string;
  status: string;
  priority: string;
}

const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English (Standard)" },
  { code: "hi", label: "हिन्दी (Hindi)" },
  { code: "mr", label: "मराठी (Marathi)" },
  { code: "bn", label: "বাংলা (Bengali)" },
  { code: "ta", label: "தமிழ் (Tamil)" },
  { code: "te", label: "తెలుగు (Telugu)" },
  { code: "gu", label: "ગુજરાતી (Gujarati)" },
  { code: "kn", label: "ಕನ್ನಡ (Kannada)" },
  { code: "pa", label: "ਪੰਜਾਬੀ (Punjabi)" },
];

export default function DossierPage() {
  const { id } = useParams<{ id: string }>();

  const [dossiers, setDossiers] = useState<DossierRow[]>([]);
  const [caseInfo, setCaseInfo] = useState<CaseHeaderInfo | null>(null);
  const [selectedLang, setSelectedLang] = useState<string>("en");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const { toast, view } = useToast();

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get<{ data?: any } | any>(`/cases/${id}`);
      const raw = data?.data ?? data;
      if (raw) {
        setCaseInfo({
          id: raw.id ?? id,
          caseNumber: raw.caseNumber ?? "FIR-RECORD",
          title: raw.title ?? "Untitled Case",
          status: raw.status ?? "OPEN",
          priority: raw.priority ?? "HIGH",
        });
        setDossiers(raw.dossiers ?? []);
      }
    } catch {
      /* Fallback if route structure differs */
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function generate() {
    setGenerating(true);
    try {
      const { data } = await api.post<DossierRow>(`/dossier/generate/${id}`, {
        language: selectedLang,
      });
      setDossiers((prev) => [data, ...prev]);
      const langLabel = SUPPORTED_LANGUAGES.find((l) => l.code === selectedLang)?.label ?? selectedLang;
      toast(
        "Charge Sheet Compiled",
        `${data.pageCount} pages generated in ${langLabel}.`
      );
    } catch (err) {
      toast("Generation Failed", extractErrorMessage(err), "destructive");
    } finally {
      setGenerating(false);
    }
  }

 const resolveLanguage = (dossier: DossierRow) => {
    if (dossier.language) {
      const found = SUPPORTED_LANGUAGES.find((l) => l.code === dossier.language?.toLowerCase());
      if (found) return found;
    }
    if (dossier.localPath) {
      const parts = dossier.localPath.replace(/\.pdf$/i, "").split("_");
      for (let i = parts.length - 1; i >= 0; i--) {
        const token = parts[i]?.toLowerCase();
        if (token) {
          const found = SUPPORTED_LANGUAGES.find((l) => l.code === token);
          if (found) return found;
        }
      }
    }
    return { code: "en", label: "English (Standard)" };
  };

  return (
    <div className="space-y-5">
      {/* TOP-LEFT BACK BUTTON & CONTEXT STRIP */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200/80 pb-3">
        <div className="flex items-center gap-2 font-mono text-xs">
          <Link
            href="/cases"
            className="group inline-flex items-center gap-1.5 rounded-lg border border-slate-200/90 bg-white px-3 py-1.5 font-bold text-slate-700 shadow-xs transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950"
          >
            <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-1 text-slate-500 group-hover:text-slate-900" />
            <span>CASE REPOSITORY</span>
          </Link>

          <span className="text-slate-300">/</span>

          <Link
            href={`/cases/${id}`}
            className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-900 font-semibold transition"
          >
            <span>Case Overview</span>
            <ChevronRight className="h-3 w-3 text-slate-400" />
          </Link>

          <span className="font-bold text-slate-900 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded">
            {caseInfo?.caseNumber ?? "DOSSIER"}
          </span>
        </div>

        {caseInfo && (
          <div className="flex items-center gap-2 font-mono text-[11px]">
            <span className="text-slate-400 uppercase">Status:</span>
            <span className="font-extrabold text-sky-800 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded">
              {caseInfo.status.replace(/_/g, " ")}
            </span>
          </div>
        )}
      </div>

      {/* CHARGE SHEET COMPILER BANNER & MULTILINGUAL SELECTOR */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200/90 bg-white p-5 shadow-sm">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="h-2 w-2 rounded-full bg-purple-600 animate-pulse" />
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
              Statutory Charge Sheet Engine
            </span>
          </div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">
            Form No. 5.11 // Police Charge Sheet
          </h1>
          <p className="text-xs text-slate-500 mt-1 max-w-2xl font-medium leading-relaxed">
            Statutory Final Report under Section 173 Cr.P.C. / Section 193 B.N.S.S. Select any official Indian language for certified judicial translation.
          </p>
        </div>

        {/* Multilingual Selector & Action Button */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1">
            <Globe className="h-3.5 w-3.5 text-slate-400" />
            <select
              value={selectedLang}
              onChange={(e) => setSelectedLang(e.target.value)}
              disabled={generating}
              aria-label="Select Charge Sheet Language"
              className="bg-transparent font-mono text-xs font-bold text-slate-700 outline-none cursor-pointer"
            >
              {SUPPORTED_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label}
                </option>
              ))}
            </select>
          </div>

          <Button 
            onClick={() => void generate()} 
            disabled={generating}
            className="h-9 px-4 gap-2 font-bold font-mono text-xs bg-slate-900 text-white hover:bg-slate-800 shadow-sm"
          >
            {generating ? (
              <>Compiling Form...</>
            ) : (
              <>
                <Zap className="h-4 w-4 text-amber-400" />
                Generate Charge Sheet (PDF)
              </>
            )}
          </Button>
        </div>
      </div>

      {loading && <Skeleton className="h-40 w-full rounded-xl" />}

      {/* GENERATED DOSSIERS GRID */}
      <div className="grid gap-4 md:grid-cols-2">
        {dossiers.map((d, index) => {
          const langMeta = resolveLanguage(d);

          return (
            <Card 
              key={d.id} 
              className="relative overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-xs hover:border-slate-300 transition"
            >
              <span className="absolute top-0 left-0 h-2 w-2 border-t-2 border-l-2 border-slate-400 rounded-tl-[3px]" />
              <span className="absolute top-0 right-0 h-2 w-2 border-t-2 border-r-2 border-slate-400 rounded-tr-[3px]" />

              <CardHeader className="border-b border-slate-100 pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-sm font-bold text-slate-900 font-mono">
                    <FileText className="h-4 w-4 text-purple-600" />
                    FORM NO. 5.11 // CHARGE SHEET #{dossiers.length - index}
                  </CardTitle>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] font-black uppercase px-2 py-0.5 rounded border border-purple-200 bg-purple-50 text-purple-700">
                      {langMeta.code.toUpperCase()}
                    </span>
                    <Badge variant="info" className="font-mono text-[10px] font-extrabold">
                      {d.pageCount} PAGES
                    </Badge>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-3 pt-3 text-xs">
                {/* Language Row */}
                <div className="flex items-center justify-between font-mono text-slate-600">
                  <span className="flex items-center gap-1.5 text-slate-400">
                    <Globe className="h-3.5 w-3.5 text-purple-500" /> Statutory Language:
                  </span>
                  <span className="font-bold text-slate-800 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded text-[11px]">
                    {langMeta.label}
                  </span>
                </div>

                {/* Filing Timestamp */}
                <div className="flex items-center justify-between font-mono text-slate-600">
                  <span className="flex items-center gap-1.5 text-slate-400">
                    <Clock className="h-3.5 w-3.5" /> Filing Timestamp:
                  </span>
                  <span className="font-semibold text-slate-800">{formatDate(d.generatedAt)}</span>
                </div>

                {/* Tamper Digest */}
                <div className="flex items-center justify-between font-mono text-slate-600">
                  <span className="flex items-center gap-1.5 text-slate-400">
                    <ShieldAlert className="h-3.5 w-3.5" /> Tamper Digest (SHA-256):
                  </span>
                  <span className="font-bold text-slate-800 bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded text-[11px]">
                    {d.sha256Hash.slice(0, 18)}…
                  </span>
                </div>

                {/* Actions & Verification */}
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                  <span className="font-mono text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded font-bold flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Court Admissible
                  </span>

                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 font-mono text-xs font-bold gap-1.5 border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-800"
                    onClick={async () => {
                      try {
                        const response = await api.get(`/dossier/${d.id}/download`, {
                          responseType: "blob",
                        });

                        const blobUrl = URL.createObjectURL(response.data);
                        const link = document.createElement("a");
                        link.href = blobUrl;
                        link.target = "_blank";
                        link.rel = "noopener noreferrer";
                        link.click();

                        setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
                      } catch (err) {
                        toast("Document stream failed", extractErrorMessage(err), "destructive");
                      }
                    }}
                  >
                    <ExternalLink className="h-3.5 w-3.5 text-slate-500" />
                    View Charge Sheet (PDF)
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {!loading && dossiers.length === 0 && (
        <Card className="rounded-xl border border-slate-200/90 bg-white shadow-xs">
          <CardContent className="p-12 text-center text-sm">
            <FileText className="h-10 w-10 text-slate-300 mx-auto mb-3" />
            <p className="font-mono text-xs font-bold uppercase text-slate-700">
              No Statutory Charge Sheets Generated Yet
            </p>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
              Select your desired language and click <b>Generate Charge Sheet (PDF)</b> to compile the official court record.
            </p>
          </CardContent>
        </Card>
      )}

      {view}
    </div>
  );
}