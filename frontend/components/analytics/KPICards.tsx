"use client";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { DashboardKpis } from "@shared/types";

const KPI_DEFS: { key: keyof DashboardKpis; label: string; icon: string }[] = [
  { key: "totalCases", label: "Total Cases", icon: "📁" },
  { key: "openCases", label: "Open Cases", icon: "🔓" },
  { key: "highPriority", label: "High Priority", icon: "🚨" },
  { key: "suspects", label: "Suspects", icon: "👤" },
  { key: "evidenceCount", label: "Evidence Items", icon: "🗂️" },
  { key: "unresolvedAlerts", label: "Unresolved Alerts", icon: "🔔" },
  { key: "kingpins", label: "Kingpins", icon: "👑" },
];

export function KPICards({ kpis, loading }: { kpis?: DashboardKpis; loading: boolean }) {
  if (loading || !kpis) {
    return (
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="mt-2 h-8 w-10" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-7">
      {KPI_DEFS.map((def) => (
        <Card key={def.key as string}>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">
              {def.icon} {def.label}
            </div>
            <div className="mt-1 text-2xl font-bold">{kpis[def.key] ?? 0}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
