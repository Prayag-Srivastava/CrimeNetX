"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, extractErrorMessage } from "@/lib/api";
import { FIRUploader } from "@/components/uploads/FIRUploader";
import { CDRUploader } from "@/components/uploads/CDRUploader";
import { EvidenceUploader } from "@/components/uploads/EvidenceUploader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Evidence } from "@shared/types";
import { formatDate } from "@/lib/utils";

const typeVariant: Record<string, "danger" | "info" | "warning" | "success" | "secondary"> = {
  FIR: "danger",
  CDR: "info",
  BANK: "warning",
  PHOTO: "success",
  DOCUMENT: "secondary",
  CCTV: "info",
};

export default function EvidencePage() {
  const { id } = useParams<{ id: string }>();
  const [items, setItems] = useState<Evidence[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const { data } = await api.get<{ data: Evidence[] }>(`/evidence/case/${id}`);
      setItems(data.data);
      setError(null);
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold">Evidence Register</h2>
        <p className="text-sm text-muted-foreground">Every item carries a SHA-256 hash for chain of custody.</p>
      </div>
      {error && <div className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      <div className="grid gap-5 lg:grid-cols-3">
        <FIRUploader caseId={id} onUploaded={() => void refresh()} />
        <CDRUploader caseId={id} onUploaded={() => void refresh()} />
        <EvidenceUploader caseId={id} onUploaded={() => void refresh()} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Uploaded evidence ({items.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>File</TableHead>
                <TableHead>SHA-256</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead>By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <Badge variant={typeVariant[e.type] ?? "secondary"}>{e.type}</Badge>
                  </TableCell>
                  <TableCell className="max-w-56 truncate font-mono text-xs">{e.fileName}</TableCell>
                  <TableCell className="font-mono text-[10px] text-muted-foreground">{e.sha256Hash || "—"}</TableCell>
                  <TableCell className="text-xs">{formatDate(e.uploadedAt)}</TableCell>
                  <TableCell className="text-xs">{e.uploader?.name ?? "—"}</TableCell>
                </TableRow>
              ))}
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    No evidence uploaded yet.
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
