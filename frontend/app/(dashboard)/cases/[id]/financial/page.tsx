"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { 
  ArrowLeft, 
  ChevronRight, 
  ShieldCheck, 
  ArrowRightLeft, 
  Activity, 
  Search, 
  AlertTriangle, 
  HardDrive, 
  Banknote, 
  Clock, 
  GitFork,
  ArrowRight,
  ShieldAlert
} from "lucide-react";
import { api, aiApi, extractErrorMessage } from "@/lib/api";
import { CriminalNetworkGraph } from "@/components/graph/CriminalNetworkGraph";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { formatINR } from "@/lib/utils";
import type { NetworkEdge, NetworkNode, Transaction } from "@shared/types";

interface TraceResult {
  path: string[];
  hops: number;
  found: boolean;
  layering_risk: string;
}

export default function FinancialPage() {
  const { id } = useParams<{ id: string }>();
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [trace, setTrace] = useState<TraceResult | null>(null);
  const [risk, setRisk] = useState<{ risk_level: string; layered_paths: number; max_layering_hops: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast, view } = useToast();

  useEffect(() => {
    api
      .get<Transaction[]>(`/cases/${id}`)
      .then(({ data }) => {
        const transactions = (data as { transactions?: Transaction[] }).transactions ?? [];
        setTxns(transactions);
      })
      .catch(() => undefined);
  }, [id]);

  const totalVolume = useMemo(() => {
    return txns.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  }, [txns]);

  const nodes: NetworkNode[] = useMemo(() => {
    const accounts = new Set<string>();
    txns.forEach((t) => {
      accounts.add(t.fromAccount);
      accounts.add(t.toAccount);
    });
    return Array.from(accounts).map((acc, i) => ({
      id: acc,
      caseId: id,
      label: acc,
      x: 60 + (i % 6) * 130,
      y: 60 + Math.floor(i / 6) * 110,
      kingpinScore: 0,
      role: "EXECUTOR" as const,
      createdAt: new Date().toISOString(),
    }));
  }, [txns, id]);

  const edges: NetworkEdge[] = useMemo(
    () =>
      txns.map((t, i) => ({
        id: `${t.id ?? i}`,
        caseId: id,
        sourceId: t.fromAccount,
        targetId: t.toAccount,
        relationType: "financial_transfer" as const,
        weight: Math.min(1 + Math.log10(t.amount || 1) / 6, 5),
        evidence: formatINR(t.amount),
        createdAt: t.timestamp,
      })),
    [txns, id]
  );

  const traceMoney = useCallback(async () => {
    if (!source || !target) {
      toast("Enter both accounts", "Source and target are required", "destructive");
      return;
    }
    setLoading(true);
    try {
      const { data } = await aiApi.post<{ path: string[]; hops: number; found: boolean; layering_risk: string }>("/financial/trace", {
        source_account: source,
        target_account: target,
        transactions: txns.map((t) => ({ from_account: t.fromAccount, to_account: t.toAccount, amount: t.amount, timestamp: t.timestamp })),
      });
      setTrace(data);
    } catch (err) {
      toast("Trace failed", extractErrorMessage(err), "destructive");
    } finally {
      setLoading(false);
    }
  }, [source, target, txns, toast]);

  const analyzeRisk = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await aiApi.post<{ risk_level: string; layered_paths: number; max_layering_hops: number }>(`/financial/laundering-risk/${id}`, {
        transactions: txns.map((t) => ({ from_account: t.fromAccount, to_account: t.toAccount, amount: t.amount, timestamp: t.timestamp })),
      });
      setRisk(data);
      toast("Laundering analysis", `Risk: ${data.risk_level}`);
    } catch (err) {
      toast("Analysis failed", extractErrorMessage(err), "destructive");
    } finally {
      setLoading(false);
    }
  }, [id, txns, toast]);

  return (
    <div className="space-y-5">
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
            FINANCIAL INTELLIGENCE
          </span>
        </div>

        <div className="flex items-center gap-2 font-mono text-[11px]">
          <span className="inline-flex items-center gap-1.5 font-bold tracking-tight text-emerald-800 bg-emerald-50/90 border border-emerald-200/90 px-2.5 py-1 rounded-md shadow-2xs">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
            <span>AML / PMLA SECTION 3 FORENSICS</span>
          </span>
        </div>
      </div>

      {/* 2. COMMAND BANNER WITH METRIC TELEMETRY STRIP */}
      <div className="relative overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-xs">
        <div className="h-1 w-full bg-slate-950" />

        <div className="p-5 sm:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                Illicit Flow & Mule Detection Engine
              </span>
            </div>

            <h1 className="text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">
              Money-Flow Tracer & Laundering Matrix
            </h1>

            <p className="text-xs sm:text-sm text-slate-500 mt-1.5 max-w-3xl font-medium leading-relaxed">
              Real-time multi-hop financial ledger tracing. Analyzes structural fund dispersion, transaction layering hops, and mule network centralities.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void analyzeRisk()}
              disabled={loading || txns.length === 0}
              className="h-9 px-3.5 gap-2 font-mono text-xs font-bold border-slate-200 bg-white text-slate-800 hover:bg-slate-50 shadow-2xs active:scale-[0.98] disabled:opacity-40"
            >
              <Activity className="h-4 w-4 text-purple-600" />
              <span>Laundering Risk Analysis</span>
            </Button>
          </div>
        </div>

        {/* Telemetry Summary HUD */}
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-slate-200/80 bg-slate-50/75 border-t border-slate-200/90 font-mono text-center">
          <div className="py-3 px-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold flex items-center justify-center gap-1.5">
              <ArrowRightLeft className="h-3.5 w-3.5 text-slate-400" /> Total Transfers
            </div>
            <div className="text-lg font-black text-slate-900 mt-0.5 tabular-nums">{txns.length}</div>
          </div>

          <div className="py-3 px-3">
            <div className="text-[10px] uppercase tracking-wider text-emerald-600 font-bold flex items-center justify-center gap-1.5">
              <Banknote className="h-3.5 w-3.5 text-emerald-500" /> Total Volume
            </div>
            <div className="text-lg font-black text-emerald-800 mt-0.5 tabular-nums">
              {formatINR(totalVolume)}
            </div>
          </div>

          <div className="py-3 px-3">
            <div className="text-[10px] uppercase tracking-wider text-sky-600 font-bold flex items-center justify-center gap-1.5">
              <GitFork className="h-3.5 w-3.5 text-sky-500" /> Transacting Nodes
            </div>
            <div className="text-lg font-black text-sky-800 mt-0.5 tabular-nums">{nodes.length} Accounts</div>
          </div>

          <div className="py-3 px-3">
            <div className="text-[10px] uppercase tracking-wider text-purple-600 font-bold flex items-center justify-center gap-1.5">
              <ShieldAlert className="h-3.5 w-3.5 text-purple-500" /> Layering Index
            </div>
            <div className="text-lg font-black text-purple-800 mt-0.5">
              {risk?.risk_level ? `${risk.risk_level} RISK` : "UNVERIFIED"}
            </div>
          </div>
        </div>
      </div>

      {/* 3. RISK ASSESSMENT HUD (IF RUN) */}
      {risk && (
        <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-2xs font-mono">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">AI Laundering Vector:</span>
              <span
                className={`text-xs font-black uppercase px-2.5 py-0.5 rounded border ${
                  risk.risk_level === "HIGH"
                    ? "bg-rose-50 text-rose-700 border-rose-200"
                    : risk.risk_level === "MEDIUM"
                    ? "bg-amber-50 text-amber-800 border-amber-200"
                    : "bg-emerald-50 text-emerald-700 border-emerald-200"
                }`}
              >
                {risk.risk_level} THREAT
              </span>
            </div>

            <div className="flex items-center gap-4 text-xs text-slate-600">
              <div>
                <span className="text-slate-400 uppercase text-[10px]">Layered Paths: </span>
                <span className="font-bold text-slate-900">{risk.layered_paths}</span>
              </div>
              <div>
                <span className="text-slate-400 uppercase text-[10px]">Max Hop Depth: </span>
                <span className="font-bold text-slate-900">{risk.max_layering_hops} Hops</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. MONEY TRAIL TRACER TERMINAL DOCK */}
      <Card className="relative overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-xs">
        <span className="absolute top-0 left-0 h-2 w-2 border-t-2 border-l-2 border-slate-400 rounded-tl-[3px]" />
        <span className="absolute top-0 right-0 h-2 w-2 border-t-2 border-r-2 border-slate-400 rounded-tr-[3px]" />

        <CardHeader className="border-b border-slate-100 pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 font-mono text-sm font-bold text-slate-950">
              <Search className="h-4 w-4 text-purple-600" />
              <span>MULTI-HOP LEDGER TRACER</span>
            </CardTitle>
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Directional Path Discovery
            </span>
          </div>
        </CardHeader>

        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-end gap-3.5">
            <div className="space-y-1.5 flex-1 max-w-sm">
              <Label className="font-mono text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                Source Account (Originator)
              </Label>
              <Input
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="e.g. 50100234567890"
                className="font-mono text-xs bg-slate-50/50 border-slate-200 focus:bg-white h-9"
              />
            </div>

            <div className="space-y-1.5 flex-1 max-w-sm">
              <Label className="font-mono text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                Target Account (Beneficiary)
              </Label>
              <Input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="e.g. 30201112223344"
                className="font-mono text-xs bg-slate-50/50 border-slate-200 focus:bg-white h-9"
              />
            </div>

            <Button
              onClick={() => void traceMoney()}
              disabled={loading}
              className="h-9 px-5 gap-1.5 font-mono text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 shadow-2xs active:scale-[0.98]"
            >
              {loading ? (
                <span>Tracing Ledger…</span>
              ) : (
                <>
                  <GitFork className="h-3.5 w-3.5 text-slate-300" />
                  <span>Execute Trace</span>
                </>
              )}
            </Button>
          </div>

          {/* Trace Results View */}
          {trace && (
            <div className="mt-4 rounded-lg border border-slate-200/90 bg-slate-50/70 p-4 font-mono">
              {trace.found ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 pb-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Traced Route:</span>
                      <span
                        className={`text-[10px] font-black uppercase px-2 py-0.5 rounded border ${
                          trace.layering_risk === "HIGH"
                            ? "bg-rose-50 text-rose-700 border-rose-200"
                            : trace.layering_risk === "MEDIUM"
                            ? "bg-amber-50 text-amber-800 border-amber-200"
                            : "bg-emerald-50 text-emerald-700 border-emerald-200"
                        }`}
                      >
                        {trace.hops} Hops · {trace.layering_risk} Risk
                      </span>
                    </div>

                    {trace.hops > 3 && (
                      <div className="flex items-center gap-1.5 text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded">
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        <span>Layering Threshold Exceeded (&gt;3 Hops)</span>
                      </div>
                    )}
                  </div>

                  {/* Flow Steps Rendering */}
                  <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-slate-800">
                    {trace.path.map((acc, index) => (
                      <div key={acc} className="inline-flex items-center gap-1.5">
                        <span className="px-2.5 py-1 rounded bg-white border border-slate-200/90 shadow-2xs font-mono text-[11px] text-slate-900">
                          {acc}
                        </span>
                        {index < trace.path.length - 1 && (
                          <ArrowRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-slate-500 font-medium flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-slate-400 shrink-0" />
                  <span>No connected transactional flow discovered between the specified accounts.</span>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 5. INTERACTIVE TRANSACTION FLOW GRAPH */}
      <Card className="relative overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-xs">
        <CardHeader className="border-b border-slate-100 py-3 px-4 sm:px-5">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 font-mono text-sm font-bold text-slate-950">
              <Activity className="h-4 w-4 text-purple-600" />
              <span>RELATIONAL MONEY-FLOW TOPOLOGY</span>
            </CardTitle>
            <div className="flex items-center gap-2 font-mono text-[10px] text-slate-400">
              <span>{nodes.length} Nodes</span>
              <span>·</span>
              <span>{edges.length} Directed Links</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="w-full">
            <CriminalNetworkGraph nodes={nodes} edges={edges} onNodeClick={() => undefined} />
          </div>
        </CardContent>
      </Card>

      {/* 6. TRANSACTIONS AUDIT LEDGER */}
      <Card className="relative overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-xs">
        <span className="absolute top-0 left-0 h-2 w-2 border-t-2 border-l-2 border-slate-400 rounded-tl-[3px]" />
        <span className="absolute top-0 right-0 h-2 w-2 border-t-2 border-r-2 border-slate-400 rounded-tr-[3px]" />

        <CardHeader className="border-b border-slate-100 p-4 sm:p-5 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 font-mono text-sm font-bold text-slate-950">
              <ArrowRightLeft className="h-4 w-4 text-purple-600" />
              <span>STATUTORY TRANSACTION REGISTRY</span>
              <span className="text-xs font-semibold text-slate-400 font-mono">({txns.length})</span>
            </CardTitle>

            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Direct Bank Settlement Logs
            </span>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="max-h-84 overflow-y-auto">
            <Table>
              <TableHeader className="bg-slate-50/90 border-b border-slate-200/80 sticky top-0 z-10">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-500 py-3 pl-5">
                    Originating Account
                  </TableHead>
                  <TableHead className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-500 py-3">
                    Destination Account
                  </TableHead>
                  <TableHead className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-500 py-3">
                    Remitted Value
                  </TableHead>
                  <TableHead className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-500 py-3">
                    Settlement Channel
                  </TableHead>
                  <TableHead className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-500 py-3 text-right pr-5">
                    Timestamp
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-slate-100 font-mono text-xs text-slate-700">
                {txns.slice(0, 60).map((t, i) => (
                  <TableRow key={t.id ?? i} className="hover:bg-slate-50/75 transition-colors">
                    <TableCell className="py-3 pl-5 font-semibold text-slate-900 whitespace-nowrap">
                      {t.fromAccount}
                    </TableCell>
                    <TableCell className="py-3 font-semibold text-slate-900 whitespace-nowrap">
                      {t.toAccount}
                    </TableCell>
                    <TableCell className="py-3 whitespace-nowrap text-emerald-800 font-bold tabular-nums">
                      {formatINR(t.amount)}
                    </TableCell>
                    <TableCell className="py-3 whitespace-nowrap">
                      <span className="font-black text-[10px] px-2 py-0.5 rounded border border-slate-200 bg-slate-50 text-slate-700 uppercase tracking-wider">
                        {t.transactionType || "TRANSFER"}
                      </span>
                    </TableCell>
                    <TableCell className="py-3 pr-5 text-right whitespace-nowrap text-slate-500 text-[11px] tabular-nums">
                      <div className="inline-flex items-center gap-1.5">
                        <Clock className="h-3 w-3 text-slate-400" />
                        <span>{new Date(t.timestamp).toLocaleString("en-IN")}</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}

                {txns.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-14 text-center">
                      <div className="mx-auto w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mb-2.5">
                        <HardDrive className="h-5 w-5 text-slate-400" />
                      </div>
                      <div className="font-mono text-xs font-bold uppercase text-slate-800">
                        No Transaction Records Ingested
                      </div>
                      <p className="font-mono text-[11px] text-slate-400 mt-1 max-w-sm mx-auto">
                        Ingest financial banking statements or UPI logs from the Evidence Register to populate the flow graph.
                      </p>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {view}
    </div>
  );
}