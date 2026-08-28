"use client";
/**
 * Timeline page — time-machine playback of the network plus an event log.
 */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, extractErrorMessage } from "@/lib/api";
import { CriminalNetworkGraph } from "@/components/graph/CriminalNetworkGraph";
import { TimeMachineSlider } from "@/components/graph/TimeMachineSlider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { NetworkPayload } from "@shared/types";
import { formatDate } from "@/lib/utils";

interface TimelineEvent {
  timestamp: string;
  event: string;
  kind?: string;
}

export default function TimelinePage() {
  const { id } = useParams<{ id: string }>();
  const [snapshots, setSnapshots] = useState<{ date: Date; payload: NetworkPayload }[]>([]);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [range, setRange] = useState({ min: new Date(Date.now() - 90 * 864e5), max: new Date() });
  const [upto, setUpto] = useState<Date>(range.max);
  const [error, setError] = useState<string | null>(null);

  const current = snapshots.find((s) => s.date.getTime() === upto.getTime())?.payload ?? null;

  useEffect(() => {
    (async () => {
      try {
        const [fullResp, caseResp] = await Promise.all([
          api.get<NetworkPayload>(`/case/${id}/network`),
          api.get<{ createdAt: string; evidence?: { uploadedAt: string; fileName: string; type: string }[]; alerts?: { createdAt: string; message: string }[] }>(
            `/cases/${id}`
          ),
        ]);
        const full = fullResp.data;
        const times = full.nodes.map((n) => new Date(n.createdAt).getTime());
        const min = times.length ? new Date(Math.min(...times)) : new Date(Date.now() - 90 * 864e5);
        const max = new Date();
        setRange({ min, max });
        setUpto(max);

        // Build playback snapshots at 8 evenly spaced points.
        const step = (max.getTime() - min.getTime()) / 8;
        const shots: { date: Date; payload: NetworkPayload }[] = [];
        for (let i = 1; i <= 8; i++) {
          const date = new Date(min.getTime() + step * i);
          const resp = await api.get<NetworkPayload>(`/case/${id}/network?upto=${encodeURIComponent(date.toISOString())}`);
          shots.push({ date, payload: resp.data });
        }
        setSnapshots(shots);

        const evts: TimelineEvent[] = [
          ...(caseResp.data.evidence ?? []).map((e) => ({ timestamp: e.uploadedAt, event: `${e.type} evidence: ${e.fileName}`, kind: "evidence" })),
          ...(caseResp.data.alerts ?? []).map((a) => ({ timestamp: a.createdAt, event: a.message, kind: "alert" })),
        ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        setEvents(evts);
      } catch (err) {
        setError(extractErrorMessage(err));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold">⏱ Time-Machine Playback</h2>
        <p className="text-sm text-muted-foreground">Watch the criminal network evolve from case start to today.</p>
      </div>
      {error && <div className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      <TimeMachineSlider min={range.min} max={range.max} value={upto} onChange={setUpto} />

      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <CriminalNetworkGraph
          nodes={current?.nodes ?? []}
          edges={current?.edges ?? []}
          onNodeClick={() => undefined}
        />
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
            Snapshot{" "}
            {snapshots.length
              ? `${(snapshots.findIndex((s) => s.date.getTime() === upto.getTime()) >= 0 ? snapshots.findIndex((s) => s.date.getTime() === upto.getTime()) : 0) + 1}/${snapshots.length}`
              : ""}
          </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Nodes</span>
                <b>{current?.nodes.length ?? 0}</b>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Edges</span>
                <b>{current?.edges.length ?? 0}</b>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Kingpins</span>
                <b>{current?.metrics.kingpins.length ?? 0}</b>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Event log</CardTitle>
            </CardHeader>
            <CardContent className="max-h-72 space-y-2 overflow-y-auto">
              {events.length === 0 && <p className="text-sm text-muted-foreground">No events recorded yet.</p>}
              {events.map((e, i) => (
                <div key={i} className="flex gap-2 text-xs">
                  <Badge variant={e.kind === "alert" ? "warning" : "info"} className="shrink-0">
                    {e.kind}
                  </Badge>
                  <div>
                    <div className="text-muted-foreground">{formatDate(e.timestamp)}</div>
                    <div>{e.event}</div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
