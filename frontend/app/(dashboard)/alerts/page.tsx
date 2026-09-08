"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, RefreshCw, Bell, AlertCircle, Check } from "lucide-react";
import { api, extractErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCaseStore } from "@/store/caseStore";
import type { Alert } from "@shared/types";
import { formatDate } from "@/lib/utils";

const severityStyles: Record<string, string> = {
  CRITICAL: "bg-rose-50 text-rose-700 border-rose-200",
  HIGH: "bg-amber-50 text-amber-800 border-amber-200",
  MEDIUM: "bg-sky-50 text-sky-700 border-sky-200",
  LOW: "bg-slate-100 text-slate-600 border-slate-200",
  INFO: "bg-emerald-50 text-emerald-700 border-emerald-200",
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
    <div className="space-y-5">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Alerts & Triage
            </h1>
            <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-700">
              {merged.filter((a) => !a.resolved).length} Unresolved
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5 font-medium">
            Real-time anomaly dispatch pushed live over WebSocket.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => void load()}
          className="h-8 gap-1.5 font-mono text-xs font-semibold border-slate-200 bg-white text-slate-700 hover:bg-slate-50 shadow-2xs self-start sm:self-auto"
        >
          <RefreshCw className="h-3.5 w-3.5 text-slate-500" />
          <span>Refresh</span>
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-mono text-rose-800">
          {error}
        </div>
      )}

      {/* SKELETON LOADING STATE */}
      {loading && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="p-4">
              <Skeleton className="h-9 w-full rounded" />
            </div>
          ))}
        </div>
      )}

      {/* UNIFIED ALERTS LIST */}
      {!loading && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
          <div className="divide-y divide-slate-100">
            {merged.map((a) => (
              <div
                key={a.id}
                className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 sm:px-4 transition-colors ${
                  a.resolved ? "bg-slate-50/40 opacity-60" : "hover:bg-slate-50/70"
                }`}
              >
                {/* Left: Badges, Message & Timestamp */}
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
                    <span
                      className={`font-black text-[10px] px-2 py-0.5 rounded border uppercase tracking-wider ${
                        severityStyles[a.severity] ?? "bg-slate-100 text-slate-700 border-slate-200"
                      }`}
                    >
                      {a.severity}
                    </span>

                    <span className="font-semibold text-[10px] text-slate-600 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded uppercase tracking-wider">
                      {a.type.replace(/_/g, " ")}
                    </span>

                    <span className="text-[11px] text-slate-400">
                      {formatDate(a.createdAt)}
                    </span>
                  </div>

                  <p className="text-xs sm:text-sm font-medium text-slate-900 leading-snug">
                    {a.message}
                  </p>
                </div>

                {/* Right: Actions */}
                <div className="flex items-center gap-2 self-start sm:self-center shrink-0 font-mono text-xs">
                  {!a.resolved ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void resolve(a.id)}
                      className="h-7 px-2.5 text-[11px] font-semibold border-slate-200 bg-white text-slate-700 hover:bg-slate-100 hover:text-slate-950 shadow-2xs"
                    >
                      <Check className="h-3 w-3 mr-1 text-slate-400" />
                      <span>Resolve</span>
                    </Button>
                  ) : (
                    <span className="inline-flex items-center font-mono text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                      Resolved
                    </span>
                  )}

                  {a.caseId && (
                    <Link
                      href={`/cases/${a.caseId}`}
                      className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-900 text-xs px-2 py-1 rounded hover:bg-slate-100 transition font-medium"
                    >
                      <span>Case</span>
                      <ArrowUpRight className="h-3 w-3 text-slate-400" />
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Empty State */}
          {merged.length === 0 && (
            <div className="p-12 text-center">
              <div className="mx-auto w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center mb-2">
                <Bell className="h-4 w-4 text-slate-400" />
              </div>
              <div className="font-mono text-xs font-bold uppercase text-slate-700">
                No Alerts Active
              </div>
              <p className="font-mono text-[11px] text-slate-400 mt-1 max-w-sm mx-auto">
                Real-time anomalies, ghost links, and cross-references will stream here automatically.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}