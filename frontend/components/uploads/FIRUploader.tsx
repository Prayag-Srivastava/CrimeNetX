"use client";
/**
 * FIRUploader — uploads an FIR PDF: presigned S3 URL -> register metadata+hash
 * -> then runs NLP entity extraction via the AI proxy.
 */
import { useState } from "react";
import { Upload } from "lucide-react";
import { api, aiApi, extractErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import type { Evidence } from "@shared/types";

export function FIRUploader({ caseId, onUploaded }: { caseId: string; onUploaded?: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [extractedEntities, setExtractedEntities] = useState<
  Array<{
    type: string;
    value: string;
    confidence: number;
    layer: string;
    attributes?: Record<string, unknown>;
  }>
>([]);
  const { toast, view } = useToast();

  async function handleUpload() {
    if (!file) return;
    setBusy(true);
    try {
      setProgress("Requesting upload URL…");
      const { data: presign } = await api.post<{ uploadUrl: string; getUrl: string; key: string; contentType: string }>(
        "/evidence/upload-url",
        { caseId, fileName: file.name, contentType: file.type || "application/pdf", type: "FIR" }
      );

      setProgress("Uploading to storage…");
      const uploadUrl = presign.uploadUrl.startsWith("/") ? presign.uploadUrl : presign.uploadUrl;
      if (uploadUrl.startsWith("/api/evidence/local-upload")) {
        // Local demo mode — upload through the backend's multipart endpoint.
        const fd = new FormData();
        fd.append("file", file);
        await api.post(`${uploadUrl}`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      } else {
        await fetch(presign.uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type || "application/pdf" } });
      }

      setProgress("Computing SHA-256…");
      const hash = await sha256(file);

      setProgress("Registering evidence…");
      const { data } = await api.post<Evidence>("/evidence", {
        caseId,
        type: "FIR",
        fileName: file.name,
        s3Url: presign.getUrl,
        sha256Hash: hash,
      });
      toast("FIR registered", `${file.name} · hash ${hash.slice(0, 12)}…`);

      setProgress("Running NLP entity extraction…");
      try {
        const text = await extractPdfText(file);
        const { data: nlpResult } = await aiApi.post<{
  entities: Array<{
    type: string;
    value: string;
    confidence: number;
    layer: string;
    attributes?: Record<string, unknown>;
  }>;
  relations: Array<Record<string, unknown>>;
  llm_used: boolean;
  warnings: string[];
}>("/nlp/extract-entities", {
  caseId,
  source_name: file.name,
  text: text.slice(0, 12000),
});

      setExtractedEntities(nlpResult.entities);

      } catch (err) {
        toast(
          "NLP extraction failed",
          extractErrorMessage(err),
          "destructive"
        );
      }

      setProgress("");
      setFile(null);
      onUploaded?.();

    } catch (err) {
      toast("Upload failed", extractErrorMessage(err), "destructive");
      setProgress("");

    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">📄 FIR Upload</CardTitle>
        <CardDescription>Chain-of-custody: every FIR gets a SHA-256 hash + automatic entity extraction.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <input
          type="file"
          accept="application/pdf"
          disabled={busy}
          onChange={(e) => {
  setFile(e.target.files?.[0] ?? null);
  setExtractedEntities([]);
}}
          className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:text-primary-foreground"
        />
        {progress && <div className="text-xs text-muted-foreground">{progress}…</div>}
        <Button onClick={() => void handleUpload()} disabled={!file || busy} className="w-full">
          <Upload className="h-4 w-4" />
          {busy ? "Uploading…" : "Upload FIR"}
        </Button>
        {view}
        {extractedEntities.length > 0 && (
  <div className="rounded-md border p-3 space-y-2">
    <div className="text-sm font-semibold">
      Extracted Entities ({extractedEntities.length})
    </div>

    {extractedEntities.map((entity, index) => (
      <div
        key={`${entity.type}-${entity.value}-${index}`}
        className="rounded-md bg-muted/50 p-2 text-xs"
      >
        <div className="flex items-center justify-between">
          <span className="font-semibold">{entity.type}</span>
          <span className="text-muted-foreground">
            {(entity.confidence * 100).toFixed(0)}%
          </span>
        </div>

        <div className="font-mono break-all">
          {entity.value}
        </div>

        <div className="text-muted-foreground">
          Layer: {entity.layer}
        </div>

        {entity.attributes?.canonical_name !== undefined && (
  <div className="text-muted-foreground">
    Canonical: {String(entity.attributes.canonical_name)}
  </div>
)}
      </div>
    ))}
  </div>
)}
      </CardContent>
    </Card>
  );
}

export async function sha256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Best-effort PDF text extraction in the browser (for the NLP step). */
async function extractPdfText(file: File): Promise<string> {
  try {
    const buf = await file.arrayBuffer();
    // Minimal PDF text extraction — production would use pdf.js.
    const decoder = new TextDecoder("latin1");
    const str = decoder.decode(buf);
    const streamMatch = str.match(/stream\r?\n([\s\S]*?)endstream/g) ?? [];
    return streamMatch
      .map((s) => s.replace(/^stream\r?\n/, "").replace(/endstream$/, ""))
      .filter((s) => /^[\x20-\x7E]*$/.test(s))
      .join(" ")
      .slice(0, 20000);
  } catch {
    return "";
  }
}
