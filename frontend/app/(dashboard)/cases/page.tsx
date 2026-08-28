"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, extractErrorMessage } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import type { CaseSummary, CaseStatus, CasePriority } from "@shared/types";
import { CCTNSSyncModal } from "@/components/shared/CCTNSSyncModal";

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

export default function CasesPage() {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const fetchCases = useCallback(async (query = "") => {
    setLoading(true);
    try {
      const { data } = await api.get<{ data: CaseSummary[]; total: number }>(`/cases?pageSize=50${query ? `&search=${encodeURIComponent(query)}` : ""}`);
      setCases(data.data);
      setTotal(data.total);
      setError(null);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchCases();
  }, [fetchCases]);

  useEffect(() => {
    const t = setTimeout(() => void fetchCases(search), 350);
    return () => clearTimeout(t);
  }, [search, fetchCases]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Cases</h2>
          <p className="text-sm text-muted-foreground">{total} records in your scope</p>
        </div>
        <div className="flex items-center gap-2">
          <CCTNSSyncModal onSyncComplete={() => void fetchCases(search)} />
          <Link href="/cases/new">
          <Button>+ New Case</Button>
          </Link>
        </div>
      </div>

      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search case number, title, jurisdiction…" className="max-w-md" />
      {error && <div className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Case No.</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Jurisdiction</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading &&
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-20" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              {!loading &&
                cases.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs">{c.caseNumber}</TableCell>
                    <TableCell>
                      <Link href={`/cases/${c.id}`} className="font-medium text-primary hover:underline">
                        {c.title}
                      </Link>
                    </TableCell>
                    <TableCell>{c.jurisdiction}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[c.status]}>{c.status.replace(/_/g, " ")}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={priorityVariant[c.priority]}>{c.priority}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(c.updatedAt)}</TableCell>
                  </TableRow>
                ))}
              {!loading && cases.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    No cases found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
