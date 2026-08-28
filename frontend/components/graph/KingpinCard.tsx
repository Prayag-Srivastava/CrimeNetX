"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { NetworkNode } from "@shared/types";

const roleVariant: Record<string, "danger" | "warning" | "success"> = {
  KINGPIN: "danger",
  BROKER: "warning",
  EXECUTOR: "success",
};

export function KingpinCard({ nodes }: { nodes: NetworkNode[] }) {
  const sorted = [...nodes].sort((a, b) => b.kingpinScore - a.kingpinScore).slice(0, 5);

  if (sorted.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          No kingpin scores yet — rebuild the network to rank suspects.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">👑 Top Kingpin Scores</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {sorted.map((n, i) => (
          <div key={n.id} className="flex items-center gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold">
              {i + 1}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{n.label}</div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(100, n.kingpinScore)}%`,
                    background: n.kingpinScore > 70 ? "#dc2626" : n.kingpinScore >= 40 ? "#eab308" : "#16a34a",
                  }}
                />
              </div>
            </div>
            <div className={cn("w-12 text-right font-mono text-sm font-bold")}>{n.kingpinScore.toFixed(0)}</div>
            <Badge variant={roleVariant[n.role] ?? "secondary"}>{n.role}</Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
