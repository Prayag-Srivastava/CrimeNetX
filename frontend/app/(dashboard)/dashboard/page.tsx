"use client";
import { useEffect, useState } from "react";
import { api, extractErrorMessage } from "@/lib/api";
import { KPICards } from "@/components/analytics/KPICards";
import { PriorityBar, StatusPie } from "@/components/analytics/ChartComponents";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import type { DashboardPayload } from "@shared/types";
import { ROLE_LABELS } from "@/lib/auth";

export default function DashboardPage() {
  const { role, user } = useAuth();
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<DashboardPayload>("/analytics/dashboard")
      .then(({ data }) => setData(data))
      .catch((err) => setError(extractErrorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  const roleHeadline: Record<string, string> = {
    INVESTIGATOR: "Your assigned cases & evidence pipeline",
    DSP: "District-level analytics & alert triage",
    SP: "Multi-district oversight & resource allocation",
    DGP: "State-wide intelligence & top kingpin watch",
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Welcome, {user?.name?.split(" ").slice(-1)[0] ?? "Officer"}</h2>
        <p className="text-sm text-muted-foreground">
          {role ? ROLE_LABELS[role] : ""} — {roleHeadline[role ?? "INVESTIGATOR"] ?? ""}
        </p>
      </div>

      {error && <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <KPICards kpis={data?.kpis} loading={loading} />

      <div className="grid gap-6 lg:grid-cols-2">
        <StatusPie data={data?.byStatus ?? []} />
        <PriorityBar data={data?.byPriority ?? []} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">📁 Case intake</CardTitle>
            <CardDescription>Register a new FIR or case record</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/cases/new">
              <Button className="w-full">New Case</Button>
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">🕸️ Network analysis</CardTitle>
            <CardDescription>Interactive graph, kingpins & ghost links</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/cases">
              <Button variant="outline" className="w-full">
                Open Cases
              </Button>
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">👑 Top kingpins</CardTitle>
            <CardDescription>State-wide kingpin leaderboard</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/suspects">
              <Button variant="outline" className="w-full">
                View Suspects
              </Button>
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">🔔 Alerts</CardTitle>
            <CardDescription>Anomaly & risk triage queue</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/alerts">
              <Button variant="outline" className="w-full">
                {data?.kpis.unresolvedAlerts ?? 0} Unresolved
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
