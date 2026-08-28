"use client";
/**
 * EvidenceUploader — generic evidence upload with type + GPS metadata.
 * Types: PHOTO, DOCUMENT, CCTV, BANK. Each item gets a SHA-256 hash.
 */
import { useState } from "react";
import { Upload } from "lucide-react";
import { api, extractErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import type { EvidenceType } from "@shared/types";

export function EvidenceUploader({ caseId, onUploaded }: { caseId: string; onUploaded?: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [type, setType] = useState<EvidenceType>("PHOTO");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [busy, setBusy] = useState(false);
  const { toast, view } = useToast();

  async function handleUpload() {
    if (!file) return;
    setBusy(true);
    try {
      const { data: presign } = await api.post<{ uploadUrl: string; getUrl: string; key: string; contentType: string }>(
        "/evidence/upload-url",
        { caseId, fileName: file.name, contentType: file.type || "application/octet-stream", type }
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
        type,
        fileName: file.name,
        s3Url: presign.getUrl,
        sha256Hash: hash,
        gpsLat: lat ? parseFloat(lat) : null,
        gpsLng: lng ? parseFloat(lng) : null,
      });
      toast(`${type} registered`, `${file.name} · ${hash.slice(0, 12)}…`);
      setFile(null);
      setLat("");
      setLng("");
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
        <CardTitle className="text-base">🗂️ Evidence Upload</CardTitle>
        <CardDescription>Photos, documents, CCTV grabs — hashed for chain of custody.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <input
          type="file"
          disabled={busy}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:text-primary-foreground"
        />
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as EvidenceType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["PHOTO", "DOCUMENT", "CCTV", "BANK"] as EvidenceType[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>GPS Lat (optional)</Label>
            <Input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="18.5204" />
          </div>
          <div className="space-y-1">
            <Label>GPS Lng (optional)</Label>
            <Input value={lng} onChange={(e) => setLng(e.target.value)} placeholder="73.8567" />
          </div>
        </div>
        <Button onClick={() => void handleUpload()} disabled={!file || busy} className="w-full">
          <Upload className="h-4 w-4" />
          {busy ? "Uploading…" : "Upload Evidence"}
        </Button>
        {view}
      </CardContent>
    </Card>
  );
}
