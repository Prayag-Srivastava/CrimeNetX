"use client";
import { useState } from "react";
import { Upload } from "lucide-react";
import { api, extractErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";

/**
 * CDRUploader — uploads a CDR CSV (columns: from_number,to_number,duration_sec,
 * call_time,cell_tower,imei). The Node backend stores it; entity extraction
 * happens through the AI service.
 */
export function CDRUploader({ caseId, onUploaded }: { caseId: string; onUploaded?: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast, view } = useToast();

  async function handleUpload() {
    if (!file) return;
    setBusy(true);
    try {
      const { data: presign } = await api.post<{ uploadUrl: string; getUrl: string; key: string; contentType: string }>(
        "/evidence/upload-url",
        { caseId, fileName: file.name, contentType: file.type || "text/csv", type: "CDR" }
      );
      if (presign.uploadUrl.startsWith("/api/evidence/local-upload")) {
        const fd = new FormData();
        fd.append("file", file);
        await api.post(presign.uploadUrl, fd, { headers: { "Content-Type": "multipart/form-data" } });
      } else {
        await fetch(presign.uploadUrl, { method: "PUT", body: file });
      }

      const buffer = await file.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", buffer);
      const hash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");

      await api.post("/evidence", {
        caseId,
        type: "CDR",
        fileName: file.name,
        s3Url: presign.getUrl,
        sha256Hash: hash,
      });

      toast("CDR registered", `${file.name} · ${hash.slice(0, 12)}…`);
      setFile(null);
      onUploaded?.();
    } catch (err) {
      toast("Upload failed", extractErrorMessage(err), "destructive");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">📞 CDR Upload</CardTitle>
        <CardDescription>Call Detail Record CSV — cell tower + call graph analysis.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:text-primary-foreground"
        />
        <Button onClick={() => void handleUpload()} disabled={!file || busy} className="w-full">
          <Upload className="h-4 w-4" />
          {busy ? "Uploading…" : "Upload CDR"}
        </Button>
        {view}
      </CardContent>
    </Card>
  );
}
