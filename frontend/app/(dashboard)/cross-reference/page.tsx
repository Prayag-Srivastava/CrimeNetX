"use client";

/**
 * Cross-Reference page — ChromaDB semantic search across historical FIRs.
 * (SP+ role only — enforced by RoleGuard.)
 */

import { useState } from "react";
import { aiApi, extractErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";

type CrossReferenceMatch = {
  case_id: string;
  case_number: string;
  score: number;
  matched_entities: string[];
  matched_reason: string;
};

export default function CrossReferencePage() {
  const [caseId, setCaseId] = useState("");
  const [firText, setFirText] = useState("");
  const [matches, setMatches] = useState<CrossReferenceMatch[]>([]);
  const [busy, setBusy] = useState(false);

  const { toast, view } = useToast();

  async function run() {
    if (!firText.trim()) {
      toast(
        "FIR text required",
        "Paste the case narrative to search",
        "destructive"
      );
      return;
    }

    setBusy(true);
    setMatches([]);

    try {
      const { data } = await aiApi.post<{
        case_id: string;
        matches: CrossReferenceMatch[];
      }>(`/vector/cross-reference/${caseId || "query"}`, {
        case_id: caseId || "query",
        fir_text: firText,
        entities: [],
      });

      const results = Array.isArray(data.matches) ? data.matches : [];

      setMatches(results);

      toast(
        "Cross-reference complete",
        `${results.length} linked cases found`
      );
    } catch (err) {
      console.error("Cross-reference failed:", err);

      toast(
        "Search failed",
        extractErrorMessage(err),
        "destructive"
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h2 className="text-2xl font-bold">
          🔗 Multi-Case Cross-Reference
        </h2>

        <p className="text-sm text-muted-foreground">
          Semantic search over all historical FIRs (ChromaDB). Shared phones,
          plates, accounts and MO patterns surface serial offenders.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Search</CardTitle>

          <CardDescription>
            Paste a FIR narrative (or the case ID + text) to find linked cases.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label>Case ID (optional)</Label>

            <Input
              value={caseId}
              onChange={(e) => setCaseId(e.target.value)}
              placeholder="PUN-2024-0118"
            />
          </div>

          <div className="space-y-1.5">
            <Label>FIR narrative text</Label>

            <textarea
              className="min-h-36 w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={firText}
              onChange={(e) => setFirText(e.target.value)}
              placeholder="Paste FIR narrative here..."
            />
          </div>

          <Button onClick={() => void run()} disabled={busy}>
            {busy ? "Searching..." : "Search linked cases"}
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {matches.map((m) => (
          <Card key={m.case_id}>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <div className="font-mono text-sm font-semibold">
                  {m.case_number || m.case_id}
                </div>

                <div className="text-xs text-muted-foreground">
                  {m.matched_reason}
                </div>

                {m.matched_entities?.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {m.matched_entities.map((entity) => (
                      <span
                        key={entity}
                        className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]"
                      >
                        {entity}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <Badge
                variant={
                  m.score > 70
                    ? "danger"
                    : m.score > 40
                    ? "warning"
                    : "secondary"
                }
              >
                {Number(m.score).toFixed(1)}% match
              </Badge>
            </CardContent>
          </Card>
        ))}

        {!busy && matches.length === 0 && (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            Results will appear here. Index FIRs first via the AI service.
          </div>
        )}
      </div>

      {view}
    </div>
  );
}