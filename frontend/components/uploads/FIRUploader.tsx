"use client";
/**
 * FIRUploader — uploads FIR PDF with investigator language selection.
 * Sends the file to AI pipeline: OCR → IndicTrans2 → spaCy → Splink → Groq.
 */
import { useState } from "react";
import { Upload } from "lucide-react";
import { api, aiApi, extractErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import type { Evidence } from "@shared/types";

const SUPPORTED_LANGUAGES = [
  { code: "auto", label: "Auto-Detect Language" },
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi (हिन्दी)" },
  { code: "mr", label: "Marathi (मराठी)" },
  { code: "ta", label: "Tamil (தமிழ்)" },
  { code: "te", label: "Telugu (తెలుగు)" },
  { code: "bn", label: "Bengali (বাংলা)" },
  { code: "gu", label: "Gujarati (ગુજરાતી)" },
  { code: "kn", label: "Kannada (ಕನ್ನಡ)" },
  { code: "ml", label: "Malayalam (മലയാളം)" },
  { code: "pa", label: "Punjabi (ਪੰਜਾਬੀ)" },
];

export function FIRUploader({ caseId, onUploaded }: { caseId: string; onUploaded?: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState<string>("auto");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [meta, setMeta] = useState<Record<string, any> | null>(null);
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
    setMeta(null);
    setExtractedEntities([]);

    try {
      setProgress("Requesting upload URL…");
      const { data: presign } = await api.post<{
        uploadUrl: string;
        getUrl: string;
        key: string;
        contentType: string;
      }>("/evidence/upload-url", {
        caseId,
        fileName: file.name,
        contentType: file.type || "application/pdf",
        type: "FIR",
      });

      setProgress("Uploading to storage…");
      const uploadUrl = presign.uploadUrl.startsWith("/") ? presign.uploadUrl : presign.uploadUrl;
      if (uploadUrl.startsWith("/api/evidence/local-upload")) {
        const fd = new FormData();
        fd.append("file", file);
        await api.post(`${uploadUrl}`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      } else {
        const uploadResponse = await fetch(presign.uploadUrl, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type || "application/pdf" },
        });
        if (!uploadResponse.ok) {
          const errorText = await uploadResponse.text();
          throw new Error(`S3 upload failed (${uploadResponse.status}): ${errorText}`);
        }
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

      // ==========================================================
      // Send PDF to the new 5-stage AI pipeline
      // ==========================================================
      setProgress(
        language === "auto"
          ? "Running AI pipeline (OCR + auto-detect + translate + NER + Splink + Groq)…"
          : `Running AI pipeline (OCR + translate from ${language} + NER + Splink + Groq)…`
      );

      try {
                const formData = new FormData();
        formData.append("file", file);
        formData.append("case_id", caseId);
        if (language !== "auto") {
          formData.append("force_language", language);
        }

        // 🚨 CHANGE: Call the new pipeline route
        const { data: nlpResult } = await aiApi.post<{
          entities: Array<{
            label: string;
            text: string;
            start: number;
            end: number;
          }>;
          relationships: Array<Record<string, unknown>>;
          document_id: string;
          original_file_hash: string;
          ocr_text_hash: string;
          translated_text_hash: string;
          pipeline_version: string;
          ocr_confidence: number;
          source_language: string;
          was_translated: boolean;
        }>("nlp/process-document", formData);

        // Map the new spaCy entities to the format your React UI expects
        const mappedEntities = (nlpResult.entities ?? []).map(ent => ({
           type: ent.label,
           value: ent.text,
           confidence: 0.9,
           layer: "spacy"
        }));
        
        setExtractedEntities(mappedEntities);
        
        // Pass the entire AI response payload to your Node server to save!
        setProgress("Saving entities and rebuilding network…");
        await api.post(`/evidence/${caseId}/import-nlp`, {
          source: file.name,
          ...nlpResult // Spread all the pipeline data directly to Node!
        });

        toast(
          "AI extraction complete",
          `${nlpResult.entities?.length ?? 0} entities · ${nlpResult.relationships?.length ?? 0} relationships`
        );
      } catch (err) {
        toast("NLP extraction failed", extractErrorMessage(err), "destructive");
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
        <CardTitle className="text-base">📄 FIR Upload (Multilingual)</CardTitle>
        <CardDescription>
          Tesseract OCR → IndicTrans2 → spaCy NER → Splink Resolution → Groq Relations.
          Every step is SHA-256 hashed for court admissibility.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* ---- Language Selector ---- */}
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-700">
            FIR Document Language
          </label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            disabled={busy}
            className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none"
          >
            {SUPPORTED_LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.label}
              </option>
            ))}
          </select>
        </div>

        {/* ---- File Input ---- */}
        <input
          type="file"
          accept="application/pdf"
          disabled={busy}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setExtractedEntities([]);
            setMeta(null);
          }}
          className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:text-primary-foreground"
        />

        {progress && (
          <div className="rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-800">
            ⏳ {progress}
          </div>
        )}

        <Button onClick={() => void handleUpload()} disabled={!file || busy} className="w-full">
          <Upload className="h-4 w-4" />
          {busy ? "Processing…" : "Upload & Extract Entities"}
        </Button>
        {view}

        {/* ---- Provenance Metadata ---- */}
        {meta && (
          <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-xs">
            <div className="mb-1 font-semibold text-emerald-900">✅ Provenance Chain</div>
            <div className="space-y-0.5 font-mono text-emerald-800">
              <div>Doc ID: {meta.document_id?.slice(0, 20)}…</div>
              <div>OCR Confidence: {meta.ocr_confidence?.toFixed(1)}%</div>
              <div>Source Language: {meta.source_language}</div>
              <div>Translated: {meta.was_translated ? "Yes" : "No"}</div>
              <div>Processing: {meta.processing_time_seconds}s</div>
              <div>Hash: {meta.original_file_hash?.slice(0, 24)}…</div>
            </div>
          </div>
        )}

        {/* ---- Extracted Entities ---- */}
        {extractedEntities.length > 0 && (
          <div className="rounded-md border p-3 space-y-2 max-h-64 overflow-y-auto">
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
                <div className="font-mono break-all">{entity.value}</div>
                <div className="text-muted-foreground">Layer: {entity.layer}</div>
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