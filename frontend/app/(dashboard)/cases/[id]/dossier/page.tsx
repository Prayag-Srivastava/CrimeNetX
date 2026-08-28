"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, extractErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/utils";

interface DossierRow {
  id: string;
  caseId: string;
  s3Url: string;
  localPath: string;
  sha256Hash: string;
  pageCount: number;
  generatedAt: string;
}

export default function DossierPage() {
  const { id } = useParams<{ id: string }>();
  const [dossiers, setDossiers] = useState<DossierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const { toast, view } = useToast();

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get<{ data: DossierRow[] }>(`/cases/${id}`);
      setDossiers((data as { dossiers?: DossierRow[] }).dossiers ?? []);
    } catch {
      /* case may not expose dossiers yet */
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function generate() {
    setGenerating(true);
    try {
      const { data } = await api.post<DossierRow>(`/dossier/generate/${id}`);
      setDossiers((prev) => [data, ...prev]);
      toast("Dossier generated", `${data.pageCount} pages · SHA-256 ${data.sha256Hash.slice(0, 12)}…`);
    } catch (err) {
      toast("Generation failed", extractErrorMessage(err), "destructive");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">📄 Investigation Dossier</h2>
          <p className="text-sm text-muted-foreground">
            Court-admissible PDF with network intelligence, financial trail, MO fingerprint & IPC recommendations.
          </p>
        </div>
        <Button onClick={() => void generate()} disabled={generating}>
          {generating ? "Generating…" : "⚡ Generate Dossier"}
        </Button>
      </div>

      {loading && <Skeleton className="h-40 w-full" />}

      <div className="grid gap-4 md:grid-cols-2">
        {dossiers.map((d) => (
          <Card key={d.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                Dossier
                <Badge variant="info">{d.pageCount} pages</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Generated</span>
                <span>{formatDate(d.generatedAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tamper hash</span>
                <span className="font-mono text-xs">{d.sha256Hash.slice(0, 24)}…</span>
              </div>
              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      const response = await api.get(`/dossier/${d.id}/download`, {
                        responseType: "blob",
                      });

                      const blobUrl = URL.createObjectURL(response.data);

                      const link = document.createElement("a");
                      link.href = blobUrl;
                      link.target = "_blank";
                      link.rel = "noopener noreferrer";
                      link.click();

                      setTimeout(() => {
                        URL.revokeObjectURL(blobUrl);
                      }, 60_000);
                    } catch (err) {
                      toast(
                        "PDF opening failed",
                        extractErrorMessage(err),
                        "destructive"
                      );
                    }
                  }}
                >
                  Open PDF
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {!loading && dossiers.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No dossiers generated yet. Hit <b>Generate Dossier</b> to compile one.
          </CardContent>
        </Card>
      )}
      {view}
    </div>
  );
}
