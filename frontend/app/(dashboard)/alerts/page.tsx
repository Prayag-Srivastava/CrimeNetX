"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, extractErrorMessage } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCaseStore } from "@/store/caseStore";
import type { Alert } from "@shared/types";
import { formatDate } from "@/lib/utils";

const severityVariant: Record<string, "danger" | "warning" | "secondary" | "info" | "success"> = {
  CRITICAL: "danger",
  HIGH: "warning",
  MEDIUM: "info",
  LOW: "secondary",
  INFO: "success",
};

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const storeAlerts = useCaseStore((s) => s.alerts);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<{ data: Alert[] }>("/alerts?limit=100");
      setAlerts(data.data);
      setError(null);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // merge live socket alerts on top
  const merged = [...storeAlerts.filter((a) => !alerts.some((x) => x.id === a.id)), ...alerts];

  async function resolve(id: string) {
    try {
      await api.patch(`/alerts/${id}/resolve`);
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, resolved: true } : a)));
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">🔔 Alerts & Triage</h2>
          <p className="text-sm text-muted-foreground">
            {merged.filter((a) => !a.resolved).length} unresolved — pushed live over WebSocket
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          Refresh
        </Button>
      </div>
      {error && <div className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {merged.map((a) => (
            <Card key={a.id} className={a.resolved ? "opacity-60" : ""}>
              <CardContent className="flex flex-wrap items-center gap-3 p-4">
                <Badge variant={severityVariant[a.severity] ?? "secondary"}>{a.severity}</Badge>
                <Badge variant="outline">{a.type.replace(/_/g, " ")}</Badge>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{a.message}</div>
                  <div className="text-xs text-muted-foreground">{formatDate(a.createdAt)}</div>
                </div>
                {!a.resolved && (
                  <Button size="sm" variant="outline" onClick={() => void resolve(a.id)}>
                    Resolve
                  </Button>
                )}
                {a.resolved && <Badge variant="success">Resolved</Badge>}
                <Link href={`/cases/${a.caseId}`} className="text-xs text-primary hover:underline">
                  Case →
                </Link>
              </CardContent>
            </Card>
          ))}
          {merged.length === 0 && (
            <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
              No alerts yet — they appear here in real time as anomalies, ghost links and cross-references are detected.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
