"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, extractErrorMessage } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { Suspect } from "@shared/types";

export default function SuspectsPage() {
  const [suspects, setSuspects] = useState<Suspect[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ data: Suspect[] }>("/suspects")
      .then(({ data }) => {
        setSuspects(data.data);
        setError(null);
      })
      .catch((err) => setError(extractErrorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  const filtered = suspects.filter(
    (s) =>
      s.name.toLowerCase().includes(query.toLowerCase()) ||
      s.aliases.some((a) => a.toLowerCase().includes(query.toLowerCase())) ||
      s.phoneNumbers.some((p) => p.includes(query))
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold">Suspect Registry</h2>
        <p className="text-sm text-muted-foreground">{suspects.length} profiles · ranked by kingpin score</p>
      </div>
      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, alias, phone…" className="max-w-md" />
      {error && <div className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((s) => (
            <Link key={s.id} href={`/suspects/${s.id}`}>
              <Card className="transition hover:border-primary/40 hover:shadow">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-semibold">{s.name}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {s.aliases.length > 0 ? `aka ${s.aliases.join(", ")}` : s.gender || "—"}
                      </div>
                    </div>
                    <Badge variant={s.kingpinScore > 70 ? "danger" : s.kingpinScore >= 40 ? "warning" : "success"}>
                      {s.kingpinScore.toFixed(0)}
                    </Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {s.phoneNumbers.slice(0, 2).map((p) => (
                      <span key={p} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                        {p}
                      </span>
                    ))}
                  </div>
                  <div className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">{s.role}</div>
                </CardContent>
              </Card>
            </Link>
          ))}
          {filtered.length === 0 && !loading && <div className="text-muted-foreground">No suspects match.</div>}
        </div>
      )}
    </div>
  );
}
