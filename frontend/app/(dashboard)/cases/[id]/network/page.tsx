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
import type { LinkPrediction, NetworkNode, NetworkPayload } from "@shared/types";
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

  const predictLinks = useCallback(async () => {
    if (!network) return;
    try {
      const { data } = await aiApi.post<{ predictions: LinkPrediction[] }>(`/graph/predict-links/${id}`, {
        case_id: id,
        entities: network.nodes.map((n) => ({ id: n.id, type: "PERSON", value: n.label })),
        relations: network.edges.map((e) => ({ source: e.sourceId, target: e.targetId, relation: e.relationType })),
        threshold: 0.1,
      });
      setPredictions(data.predictions);
      toast("Ghost link scan", `${data.predictions.length} hidden links predicted`);
    } catch (err) {
      toast("Prediction failed", extractErrorMessage(err), "destructive");
    }
  }, [id, network, toast]);

  const acceptPrediction = useCallback(
    async (p: LinkPrediction, accept: boolean) => {
      try {
        await api.post(`/case/${id}/predictions/review`, { source: p.source, target: p.target, accepted: accept, score: p.score });
        setPredictions((prev) => prev.filter((x) => !(x.source === p.source && x.target === p.target)));
        toast(accept ? "Ghost link accepted" : "Prediction dismissed", `${p.source} ↔ ${p.target}`);
        if (accept) await loadNetwork();
      } catch (err) {
        toast("Error", extractErrorMessage(err), "destructive");
      }
    },
    [id, loadNetwork, toast]
  );

  const displayNodes = useMemo(() => network?.nodes ?? [], [network]);
  const displayEdges = useMemo(() => network?.edges ?? [], [network]);

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
        <CriminalNetworkGraph nodes={displayNodes} edges={displayEdges} onNodeClick={setSelected} />
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
              {predictions.slice(0, 6).map((p, i) => (
                <div key={i} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{p.source}</span>
                    <span className="text-muted-foreground">↔</span>
                    <span className="font-medium">{p.target}</span>
                    <Badge variant={p.score > 0.5 ? "warning" : "secondary"}>{Math.round(p.score * 100)}%</Badge>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="success" onClick={() => void acceptPrediction(p, true)} className="h-7 px-2 text-xs">
                      Accept
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void acceptPrediction(p, false)} className="h-7 px-2 text-xs">
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
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
      {view}
    </div>
  );
}
