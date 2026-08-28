"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, extractErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import type { CasePriority, CaseStatus } from "@shared/types";

export default function NewCasePage() {
  const router = useRouter();
  const { toast, view } = useToast();
  const [form, setForm] = useState({
    caseNumber: "",
    title: "",
    description: "",
    jurisdiction: "",
    status: "OPEN" as CaseStatus,
    priority: "MEDIUM" as CasePriority,
  });
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.post<{ id: string }>("/cases", form);
      toast("Case created", form.caseNumber);
      router.push(`/cases/${data.id}`);
    } catch (err) {
      toast("Error", extractErrorMessage(err), "destructive");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h2 className="text-2xl font-bold">Register New Case</h2>
      <Card>
        <CardHeader>
          <CardTitle>Case details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Case number *</Label>
                <Input required value={form.caseNumber} onChange={(e) => setForm({ ...form, caseNumber: e.target.value })} placeholder="PUN-2026-0001" />
              </div>
              <div className="space-y-1.5">
                <Label>Jurisdiction</Label>
                <Input value={form.jurisdiction} onChange={(e) => setForm({ ...form, jurisdiction: e.target.value })} placeholder="Pune" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Title *</Label>
              <Input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Investigation title" />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <textarea
                className="min-h-24 w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Brief facts of the case…"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as CaseStatus })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["OPEN", "UNDER_INVESTIGATION", "PENDING_REVIEW", "CLOSED", "COLD"] as CaseStatus[]).map((s) => (
                      <SelectItem key={s} value={s}>
                        {s.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v as CasePriority })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["LOW", "MEDIUM", "HIGH", "CRITICAL"] as CasePriority[]).map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Creating…" : "Create case"}
            </Button>
          </form>
        </CardContent>
      </Card>
      {view}
    </div>
  );
}
