"use client";
/**
 * Financial page — money-flow tracer + laundering risk with animated graph.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { api, aiApi, extractErrorMessage } from "@/lib/api";
import { CriminalNetworkGraph } from "@/components/graph/CriminalNetworkGraph";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
        weight: Math.min(1 + Math.log10(t.amount) / 6, 5),
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">💰 Money-Flow Tracer</h2>
          <p className="text-sm text-muted-foreground">{txns.length} transactions · animated edges = transfers</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void analyzeRisk()} disabled={loading || txns.length === 0}>
          🧾 Laundering Risk Analysis
        </Button>
      </div>

      {risk && (
        <div className="flex flex-wrap gap-3">
          <Badge variant={risk.risk_level === "HIGH" ? "danger" : risk.risk_level === "MEDIUM" ? "warning" : "success"} className="px-3 py-1 text-sm">
            Risk level: {risk.risk_level}
          </Badge>
          <Badge variant="outline" className="px-3 py-1 text-sm">
            Layered paths: {risk.layered_paths}
          </Badge>
          <Badge variant="outline" className="px-3 py-1 text-sm">
            Max hops: {risk.max_layering_hops}
          </Badge>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Trace a money trail</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label>Source account</Label>
              <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="50100234567890" className="w-52 font-mono text-xs" />
            </div>
            <div className="space-y-1">
              <Label>Target account</Label>
              <Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="30201112223344" className="w-52 font-mono text-xs" />
            </div>
            <Button onClick={() => void traceMoney()} disabled={loading}>
              {loading ? "Tracing…" : "Trace"}
            </Button>
          </div>
          {trace && (
            <div className="mt-4 rounded-lg bg-muted/60 p-3 text-sm">
              {trace.found ? (
                <>
                  <div className="mb-1 flex items-center gap-2">
                    <Badge variant={trace.layering_risk === "HIGH" ? "danger" : trace.layering_risk === "MEDIUM" ? "warning" : "success"}>
                      {trace.hops} hops · {trace.layering_risk}
                    </Badge>
                    {trace.hops > 3 && <span className="text-xs text-muted-foreground">Layering flag: &gt;3 hops (money laundering red flag)</span>}
                  </div>
                  <div className="font-mono text-xs leading-relaxed">{trace.path.join("  →  ")}</div>
                </>
              ) : (
                <div className="text-muted-foreground">No path found between these accounts.</div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <CriminalNetworkGraph nodes={nodes} edges={edges} onNodeClick={() => undefined} />

      <Card>
        <CardHeader>
          <CardTitle>Transactions ({txns.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-80 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {txns.slice(0, 60).map((t, i) => (
                  <TableRow key={t.id ?? i}>
                    <TableCell className="font-mono text-xs">{t.fromAccount}</TableCell>
                    <TableCell className="font-mono text-xs">{t.toAccount}</TableCell>
                    <TableCell className="font-mono text-xs font-semibold">{formatINR(t.amount)}</TableCell>
                    <TableCell>{t.transactionType}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(t.timestamp).toLocaleString("en-IN")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      {view}
    </div>
  );
}
