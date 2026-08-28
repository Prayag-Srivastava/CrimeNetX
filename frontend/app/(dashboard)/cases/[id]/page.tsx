"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCase } from "@/hooks/useCase";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCaseStore } from "@/store/caseStore";
import { useEffect } from "react";
import { formatDate } from "@/lib/utils";
import type { CaseStatus, CasePriority } from "@shared/types";

const statusVariant: Record<CaseStatus, "info" | "warning" | "secondary" | "success" | "outline"> = {
  OPEN: "info",
  UNDER_INVESTIGATION: "warning",
  PENDING_REVIEW: "secondary",
  CLOSED: "success",
  COLD: "outline",
};
const priorityVariant: Record<CasePriority, "danger" | "warning" | "info" | "outline"> = {
  LOW: "outline",
  MEDIUM: "info",
  HIGH: "warning",
  CRITICAL: "danger",
};

const TABS = [
  { href: "", label: "Overview" },
  { href: "/network", label: "Network" },
  { href: "/timeline", label: "Timeline" },
  { href: "/evidence", label: "Evidence" },
  { href: "/financial", label: "Financial" },
  { href: "/map", label: "Map" },
  { href: "/dossier", label: "Dossier" },
];

export default function CaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { caseData, stats, suspects, loading, error } = useCase(id);
  const setActiveCaseId = useCaseStore((s) => s.setActiveCaseId);

  useEffect(() => {
    setActiveCaseId(id);
    return () => setActiveCaseId(null);
  }, [id, setActiveCaseId]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (error) return <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;
  if (!caseData) return <div className="text-muted-foreground">Case not found.</div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="font-mono">{caseData.caseNumber}</span>
            <Badge variant={statusVariant[caseData.status]}>{caseData.status.replace(/_/g, " ")}</Badge>
            <Badge variant={priorityVariant[caseData.priority]}>{caseData.priority}</Badge>
          </div>
          <h2 className="mt-1 text-2xl font-bold">{caseData.title}</h2>
          <p className="text-sm text-muted-foreground">
            {caseData.jurisdiction} · Registered {formatDate(caseData.createdAt)}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link key={t.href} href={`/cases/${id}${t.href}`}>
            <Button variant="outline" size="sm">
              {t.label}
            </Button>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Description</CardTitle>
            </CardHeader>
            <CardContent className="text-sm leading-relaxed">{caseData.description || "No description provided."}</CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Suspects</CardTitle>
              <CardDescription>Ranked by kingpin score</CardDescription>
            </CardHeader>
            <CardContent>
              {suspects.length === 0 && <div className="text-sm text-muted-foreground">No suspects linked yet.</div>}
              <div className="grid gap-3 sm:grid-cols-2">
                {suspects.slice(0, 8).map((s) => (
                  <Link key={s.id} href={`/suspects/${s.id}`} className="rounded-lg border p-3 transition hover:bg-muted/50">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{s.name}</span>
                      <Badge variant={s.kingpinScore > 70 ? "danger" : s.kingpinScore >= 40 ? "warning" : "success"}>
                        {s.kingpinScore.toFixed(0)}
                      </Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {s.role} {s.aliases.length > 0 ? `· aka ${s.aliases.join(", ")}` : ""}
                    </div>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Case stats</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-sm">
              {stats &&
                Object.entries(stats).map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-muted/60 p-3">
                    <div className="text-xs capitalize text-muted-foreground">{k.replace(/([A-Z])/g, " $1")}</div>
                    <div className="text-xl font-bold">{v as number}</div>
                  </div>
                ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
