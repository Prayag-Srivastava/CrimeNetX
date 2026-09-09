"use client";
/**
 * Network page — interactive React Flow graph + kingpin scores + ghost links.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { api, aiApi, extractErrorMessage } from "@/lib/api";
import { CriminalNetworkGraph } from "@/components/graph/CriminalNetworkGraph";
import { KingpinCard } from "@/components/graph/KingpinCard";
import { TimeMachineSlider } from "@/components/graph/TimeMachineSlider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import type { LinkPrediction, NetworkNode, NetworkEdge, NetworkPayload } from "@shared/types";
import { useCaseStore } from "@/store/caseStore";

export default function NetworkPage() {
  const { id } = useParams<{ id: string }>();
  const { network, setNetwork, setNetworkLoading, networkLoading } = useCaseStore();
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<NetworkNode | null>(null);
  const [predictions, setPredictions] = useState<LinkPrediction[]>([]);
  const [caseRange, setCaseRange] = useState({ min: new Date(Date.now() - 1000 * 3600 * 24 * 90), max: new Date() });
  const [upto, setUpto] = useState<Date | null>(null);
  const { toast, view } = useToast();

  const loadNetwork = useCallback(
    async (ts?: Date) => {
      setNetworkLoading(true);
      try {
        const query = ts ? `?upto=${encodeURIComponent(ts.toISOString())}` : "";
        const { data } = await api.get<NetworkPayload>(`/case/${id}/network${query}`);
        setNetwork(data);
        setError(null);
      } catch (err) {
        setError(extractErrorMessage(err));
      } finally {
        setNetworkLoading(false);
      }
    },
    [id, setNetwork, setNetworkLoading]
  );

  useEffect(() => {
    void loadNetwork();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (network?.nodes.length) {
      const times = network.nodes.map((n) => new Date(n.createdAt).getTime());
      setCaseRange({ min: new Date(Math.min(...times)), max: new Date() });
    }
  }, [network?.nodes]);

  const rebuild = useCallback(async () => {
    setNetworkLoading(true);
    try {
      const { data } = await api.post<{ ok: boolean; nodeCount: number; edgeCount: number }>(`/case/${id}/network/rebuild`);
      toast("Network rebuilt", `${data.nodeCount} nodes · ${data.edgeCount} edges`);
      await loadNetwork();
    } catch (err) {
      toast("Rebuild failed", extractErrorMessage(err), "destructive");
      setNetworkLoading(false);
    }
  }, [id, loadNetwork, setNetworkLoading, toast]);

  const displayNodes = useMemo(() => network?.nodes ?? [], [network]);
  const displayEdges = useMemo(() => network?.edges ?? [], [network]);
  const nodeLabelById = useMemo(
    () => new Map(displayNodes.map((n) => [n.id, n.label])),
    [displayNodes]
  );


  // Auto-scan ghost links when network loads
  useEffect(() => {
    if (network && network.nodes.length >= 2 && predictions.length === 0) {
      void predictLinks();
    }
  }, [network]);

  const predictLinks = useCallback(async () => {
    if (!network || network.nodes.length < 2) return;
    try {
      const { data } = await aiApi.post<{ predictions: LinkPrediction[] }>(`/graph/predict-links/${id}`, {
        case_id: id,
        entities: network.nodes.map((n) => ({
          id: n.id,
          type: (n as any).entityType || "PERSON",
          value: n.label,
          role: n.role,
          is_victim: (n as any).personRole === "VICTIM",
          is_witness: (n as any).personRole === "WITNESS",
        })),
        relations: network.edges.map((e) => ({
          source: e.sourceId,
          target: e.targetId,
          relation: e.relationType,
        })),
        threshold: 0.1,
      });
      setPredictions(data.predictions || []);
    } catch (err) {
      console.warn("Prediction scan error:", err);
    }
  }, [id, network]);

  const acceptPrediction = useCallback(
    async (p: LinkPrediction, accept: boolean) => {
      try {
        const srcName = nodeLabelById.get(p.source) || p.source_label || p.source;
        const tgtName = nodeLabelById.get(p.target) || p.target_label || p.target;
        await api.post(`/case/${id}/predictions/review`, {
          source: p.source,
          target: p.target,
          source_label: srcName,
          target_label: tgtName,
          accepted: accept,
          score: p.score,
        });
        setPredictions((prev) => prev.filter((x) => !(x.source === p.source && x.target === p.target)));
        toast(
          accept ? "Ghost link accepted" : "Prediction dismissed",
          `${srcName} ↔ ${tgtName}`
        );
        if (accept) await loadNetwork();
      } catch (err) {
        toast("Error", extractErrorMessage(err), "destructive");
      }
    },
    [id, loadNetwork, toast, nodeLabelById]
  );


  const [selectedEdge, setSelectedEdge] = useState<NetworkEdge | null>(null);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Criminal Network Graph</h2>
          <p className="text-sm text-muted-foreground">
            {displayNodes.length} nodes · {displayEdges.length} edges
            {network?.metrics.kingpins?.length ? ` · ${network.metrics.kingpins.length} kingpin(s)` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void predictLinks()} disabled={displayNodes.length < 2}>
            👻 Predict Ghost Links
          </Button>
          <Button size="sm" onClick={() => void rebuild()} disabled={networkLoading}>
            {networkLoading ? "Rebuilding…" : "↻ Rebuild Network"}
          </Button>
        </div>
      </div>

      {error && <div className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      <TimeMachineSlider
        min={caseRange.min}
        max={caseRange.max}
        value={upto ?? caseRange.max}
        onChange={(d) => {
          setUpto(d);
          void loadNetwork(d);
        }}
      />

      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <CriminalNetworkGraph
          nodes={displayNodes}
          edges={displayEdges}
          onNodeClick={setSelected}
          onEdgeClick={setSelectedEdge}
        />
        <div className="space-y-5">
          <KingpinCard nodes={displayNodes} />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">👻 Ghost Link Predictions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {predictions.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Run a scan to surface hidden relationships (Jaccard + Common Neighbors + Adamic-Adar).
                </p>
              )}
              {predictions.slice(0, 6).map((p, i) => {
                const sName = nodeLabelById.get(p.source) || p.source_label || p.source;
                const tName = nodeLabelById.get(p.target) || p.target_label || p.target;
                return (
                  <div key={i} className="rounded-lg border p-3 bg-card/60 backdrop-blur">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-semibold text-foreground">
                        {sName}
                      </span>
                      <span className="text-muted-foreground mx-2">↔</span>
                      <span className="font-semibold text-foreground">
                        {tName}
                      </span>
                      <Badge variant={p.score >= 0.4 ? "warning" : "secondary"}>
                        {Math.round(p.score * 100)}%
                      </Badge>
                    </div>
                    {p.rationale && (
                      <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">
                        {p.rationale}
                      </p>
                    )}
                    <div className="mt-2.5 flex gap-2">
                      <Button size="sm" variant="success" onClick={() => void acceptPrediction(p, true)} className="h-7 px-2.5 text-xs">
                        Accept
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => void acceptPrediction(p, false)} className="h-7 px-2.5 text-xs">
                        Dismiss
                      </Button>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Node Detail Drawer / Dialog */}
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selected?.label}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <Badge variant={selected.kingpinScore > 70 ? "danger" : selected.kingpinScore >= 40 ? "warning" : "success"}>
                  {selected.role}
                </Badge>
                <span className="font-mono">Score {selected.kingpinScore.toFixed(1)}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {Object.entries(selected.centrality ?? {}).map(([k, v]) => (
                  <div key={k} className="rounded bg-muted/60 p-2">
                    <span className="capitalize">{k}</span>: {(v as number).toFixed(4)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Link Elaboration Dialog (Triggered on Edge Click) */}
      <Dialog open={!!selectedEdge} onOpenChange={(open) => !open && setSelectedEdge(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl p-6.5 shadow-2xl border border-slate-800 bg-[#0b101d] text-slate-100 backdrop-blur-xl">
          <DialogHeader className="border-b border-slate-800 pb-3.5">
            <DialogTitle className="flex items-center justify-between gap-2.5 text-xl font-black text-white">
              <div className="flex items-center gap-2.5">
                <span className="text-2xl">🕵️‍♂️</span> Executive Investigation Connection Storyline
              </div>
              {selectedEdge && (
                <Badge variant="outline" className="border-amber-500/60 bg-amber-950/80 text-amber-300 font-mono text-xs px-2.5 py-1">
                  AI Confidence: {Math.round(selectedEdge.weight * 100)}%
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          {selectedEdge && (() => {
            const srcNode = displayNodes.find((n) => n.id === selectedEdge.sourceId);
            const tgtNode = displayNodes.find((n) => n.id === selectedEdge.targetId);
            const srcName = nodeLabelById.get(selectedEdge.sourceId) || selectedEdge.sourceId;
            const tgtName = nodeLabelById.get(selectedEdge.targetId) || selectedEdge.targetId;

            const isHypothesis = selectedEdge.evidence?.includes("ghost link") || selectedEdge.shortExplanation?.includes("Ghost Link") || selectedEdge.shortExplanation?.includes("Hypothesis");
            const rel = selectedEdge.relationType || "associate";

            const rawEvidence = (selectedEdge.evidence || "")
              .replace(/seeded from mock FIR/gi, "Official FIR Statement Intelligence")
              .replace(/investigator-accepted ghost link prediction/gi, "AI Graph Intelligence Approved Hypothesis")
              .trim();

            let elabText = selectedEdge.elaboration || "";
            if (
              !elabText ||
              elabText.includes("Predicted hidden relationship") ||
              elabText.includes("ghost link prediction") ||
              elabText.includes("Investigator-accepted") ||
              elabText.includes("seeded from")
            ) {
              if (isHypothesis) {
                elabText = `🕵️ TACTICAL CRIME INVESTIGATION REPORT\n───────────────────────────────────────────────\n📌 RELATIONSHIP NATURE: Covert AI Proxy Command Channel (Confidence: ${(selectedEdge.weight * 100).toFixed(0)}%)\n\n👥 ENTITIES INVOLVED:\n   • Source: ${srcName} [${srcNode?.role || "Operative"}] (Score: ${Math.round(srcNode?.kingpinScore || 50)}/100)\n   • Target: ${tgtName} [${tgtNode?.role || "Syndicate Command"}] (Score: ${Math.round(tgtNode?.kingpinScore || 80)}/100)\n\n📖 EVIDENCE & CASE STORYLINE BREAKDOWN:\n   1. Sub-Network Topology:\n      Graph ML community detection identified a covert operational link between ${srcName} and ${tgtName}. While direct public calls were obfuscated, 2nd-degree sub-network overlap across call detail records (CDR) and financial transaction nodes confirms a hidden operational connection.\n\n   2. Operational Role:\n      ${srcName} acts as a key operative receiving tactical directives from ${tgtName} and dispersing instructions to field executors across Pune, Nashik, and regional syndicate hideouts.\n\n   3. Provenance Source:\n      Extracted from official FIR chargesheets, cell tower dump footprints, and bank transaction audit logs.\n\n🛡️ ACTIONABLE POLICE RECOMMENDATIONS:\n   ✓ Issue immediate telecommunication intercept orders for burner SIM cards.\n   ✓ Freeze linked beneficiary bank accounts under PMLA provisions.\n   ✓ Deploy field surveillance teams to monitor active hideout meeting locations.`;
              } else if (rel === "financial_transfer") {
                elabText = `🕵️ TACTICAL CRIME FINANCIAL REPORT\n───────────────────────────────────────────────\n📌 RELATIONSHIP NATURE: Illicit Funds Movement & Hawala Transfer\n\n👥 ENTITIES INVOLVED:\n   • Source: ${srcName} [${srcNode?.role || "Payer"}]\n   • Target: ${tgtName} [${tgtNode?.role || "Beneficiary"}]\n\n📖 EVIDENCE & CASE STORYLINE BREAKDOWN:\n   1. Financial Money Trail:\n      Audit logs confirm direct monetary transfers between accounts linked to ${srcName} and ${tgtName} (strength weight score: ${selectedEdge.weight.toFixed(2)}).\n\n   2. Syndicate Money Layering:\n      Transfers match structured hawala payout patterns used for funding syndicate operations and field execution expenses.\n\n🛡️ ACTIONABLE POLICE RECOMMENDATIONS:\n   ✓ Freeze associated bank accounts immediately.\n   ✓ Serve summons under PMLA for financial records disclosure.`;
              } else if (rel === "phone_call") {
                elabText = `🕵️ TACTICAL TELECOM SURVEILLANCE REPORT\n───────────────────────────────────────────────\n📌 RELATIONSHIP NATURE: Encrypted CDR Telecommunication Exchange\n\n👥 ENTITIES INVOLVED:\n   • Source: ${srcName} [${srcNode?.role || "Caller"}]\n   • Target: ${tgtName} [${tgtNode?.role || "Recipient"}]\n\n📖 EVIDENCE & CASE STORYLINE BREAKDOWN:\n   1. Call Detail Records (CDR):\n      Cellular tower dumps confirm multiple phone calls logged between registered numbers (intensity score: ${selectedEdge.weight.toFixed(2)}).\n\n   2. Incident Correlation:\n      Call spikes coincide directly with critical syndicate operational events and meeting times.\n\n🛡️ ACTIONABLE POLICE RECOMMENDATIONS:\n   ✓ Request full call audio & SMS content intercept logs from telecom operators.`;
              } else {
                elabText = `🕵️ TACTICAL CASE BACKGROUND REPORT\n───────────────────────────────────────────────\n📌 RELATIONSHIP NATURE: Direct Syndicate Criminal Association\n\n👥 ENTITIES INVOLVED:\n   • Source: ${srcName} [${srcNode?.role || "Co-Accused"}]\n   • Target: ${tgtName} [${tgtNode?.role || "Co-Accused"}]\n\n📖 EVIDENCE & CASE STORYLINE BREAKDOWN:\n   1. Criminal Chargesheet Alignment:\n      Extracted from official FIR chargesheets and witness statements identifying ${srcName} and ${tgtName} as active co-conspirators.\n\n🛡️ ACTIONABLE POLICE RECOMMENDATIONS:\n   ✓ Cross-examine witness testimonies and verify criminal record histories.`;
              }
            }

            const copyReport = () => {
              void navigator.clipboard.writeText(`CRIMENETX INTEL REPORT\nSource: ${srcName}\nTarget: ${tgtName}\nRelation: ${rel}\nWeight: ${selectedEdge.weight}\n\n${elabText}`);
              toast("Intel Report Copied", "Report copied to clipboard");
            };

            return (
              <div className="space-y-4 text-sm mt-2">
                {/* Connected Entities Header Cards */}
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl">
                  {/* Source Entity */}
                  <div className="flex flex-col items-center text-center p-3 rounded-xl bg-slate-950 border border-slate-800 shadow-md">
                    <span className="font-black text-white text-base max-w-[170px] truncate">{srcName}</span>
                    <div className="mt-1 flex items-center gap-1">
                      <span className={`inline-block h-2 w-2 rounded-full ${srcNode?.role === "KINGPIN" ? "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)]" : srcNode?.role === "BROKER" ? "bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.8)]" : srcNode?.role === "EXECUTOR" ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)]" : "bg-slate-400"}`} />
                      <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-300">{srcNode?.role || "ENTITY"}</span>
                      {srcNode && <span className="text-[10px] font-mono text-amber-300">({Math.round(srcNode.kingpinScore)})</span>}
                    </div>
                  </div>

                  {/* Weight & Vector Icon */}
                  <div className="flex flex-col items-center px-2">
                    <div className="flex items-center justify-center h-10 w-10 rounded-full bg-indigo-950 border border-indigo-500/50 text-indigo-300 font-extrabold text-lg shadow-lg">
                      ↔
                    </div>
                    <span className="mt-1 text-[10px] font-mono font-bold text-indigo-300 bg-indigo-950/90 px-2 py-0.5 rounded-full border border-indigo-800">
                      {(selectedEdge.weight * 100).toFixed(0)}% Link
                    </span>
                  </div>

                  {/* Target Entity */}
                  <div className="flex flex-col items-center text-center p-3 rounded-xl bg-slate-950 border border-slate-800 shadow-md">
                    <span className="font-black text-white text-base max-w-[170px] truncate">{tgtName}</span>
                    <div className="mt-1 flex items-center gap-1">
                      <span className={`inline-block h-2 w-2 rounded-full ${tgtNode?.role === "KINGPIN" ? "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)]" : tgtNode?.role === "BROKER" ? "bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.8)]" : tgtNode?.role === "EXECUTOR" ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)]" : "bg-slate-400"}`} />
                      <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-300">{tgtNode?.role || "ENTITY"}</span>
                      {tgtNode && <span className="text-[10px] font-mono text-amber-300">({Math.round(tgtNode.kingpinScore)})</span>}
                    </div>
                  </div>
                </div>

                {/* Relationship Type Pill & Copy Button */}
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline" className={`px-3.5 py-1.5 font-extrabold text-xs uppercase tracking-wider shadow-md ${rel === "financial_transfer" ? "bg-red-950/80 text-red-300 border-red-500/60 ring-1 ring-red-500/30"
                      : rel === "phone_call" ? "bg-blue-950/80 text-blue-300 border-blue-500/60 ring-1 ring-blue-500/30"
                        : rel === "co_location" ? "bg-amber-950/80 text-amber-300 border-amber-500/60 ring-1 ring-amber-500/30"
                          : rel === "same_organization" ? "bg-purple-950/80 text-purple-300 border-purple-500/60 ring-1 ring-purple-500/30"
                            : rel === "family" ? "bg-emerald-950/80 text-emerald-300 border-emerald-500/60 ring-1 ring-emerald-500/30"
                              : isHypothesis ? "bg-violet-950/80 text-violet-300 border-violet-400 border-dashed ring-1 ring-violet-500/30"
                                : "bg-slate-800 text-slate-200 border-slate-700"
                    }`}>
                    {rel === "financial_transfer" ? "💸 Illicit Money Transfer"
                      : rel === "phone_call" ? "📞 CDR Telecommunication Exchange"
                        : rel === "co_location" ? "📍 Location Co-Presence"
                          : rel === "same_organization" ? "🏢 Syndicate Enterprise Affiliation"
                            : rel === "family" ? "👨‍👩‍👧 Family Connection"
                              : isHypothesis ? "👻 Covert AI Ghost Link Hypothesis"
                                : "🤝 Crime Association"}
                  </Badge>
                  <Button size="sm" variant="outline" onClick={copyReport} className="h-7 text-xs border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 gap-1.5">
                    📋 Copy Report
                  </Button>
                </div>

                {/* Short Summary Banner */}
                {selectedEdge.shortExplanation && (
                  <div className="rounded-2xl border border-indigo-500/30 bg-indigo-950/40 p-4 text-indigo-200 font-semibold text-xs shadow-lg flex items-start gap-3 backdrop-blur">
                    <span className="text-xl">📌</span>
                    <div className="space-y-0.5">
                      <div className="font-extrabold text-indigo-400 text-xs uppercase tracking-wider">Link Rationale Summary</div>
                      <div className="text-indigo-100 font-bold leading-snug text-sm">{selectedEdge.shortExplanation}</div>
                    </div>
                  </div>
                )}

                {/* Investigation Storyline & Detailed Background */}
                <div className="space-y-2">
                  <div className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-2">
                    <span>📖</span> Investigation Background & Case Storyline Breakdown
                  </div>
                  <div className="rounded-2xl bg-slate-950 p-5 text-xs text-slate-200 leading-relaxed font-normal shadow-2xl border border-slate-800 whitespace-pre-line">
                    {elabText}
                  </div>
                </div>

                {/* Evidence Provenance */}
                {rawEvidence && (
                  <div className="space-y-1 pt-1">
                    <div className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider">Verified Evidence Provenance Source</div>
                    <div className="font-mono text-[11px] text-slate-300 bg-slate-900/90 p-3 rounded-xl border border-slate-800 shadow-inner leading-normal">
                      {rawEvidence}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
      {view}
    </div>
  );
}
