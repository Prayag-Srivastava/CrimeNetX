"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, extractErrorMessage } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import type { Suspect } from "@shared/types";

export default function SuspectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [suspect, setSuspect] = useState<Suspect | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast, view } = useToast();

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<Suspect>(`/suspects/${id}`);
      setSuspect(data);
      setError(null);
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function update(fields: Partial<Suspect>) {
    setBusy(true);
    try {
      const { data } = await api.patch<Suspect>(`/suspects/${id}`, fields);
      setSuspect(data);
      toast("Suspect updated", data.name);
    } catch (err) {
      toast("Update failed", extractErrorMessage(err), "destructive");
    } finally {
      setBusy(false);
    }
  }

  if (error) return <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;
  if (!suspect) return <div className="text-muted-foreground">Loading…</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center gap-4">
        {suspect.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={suspect.photoUrl} alt={suspect.name} className="h-20 w-20 rounded-full border object-cover" />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary text-2xl font-bold text-primary-foreground">
            {suspect.name.slice(0, 1)}
          </div>
        )}
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold">{suspect.name}</h2>
            <Badge variant={suspect.kingpinScore > 70 ? "danger" : suspect.kingpinScore >= 40 ? "warning" : "success"}>
              {suspect.role}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Kingpin score <b>{suspect.kingpinScore.toFixed(1)}</b> · {suspect.address || "No address"}
          </p>
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Identifiers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Aliases</Label>
              <div className="mt-1 flex flex-wrap gap-1">
                {suspect.aliases.map((a) => (
                  <span key={a} className="rounded bg-muted px-2 py-0.5 text-xs">
                    {a}
                  </span>
                ))}
                {suspect.aliases.length === 0 && <span className="text-xs text-muted-foreground">None recorded</span>}
              </div>
            </div>
            <div>
              <Label>Phone numbers</Label>
              <div className="mt-1 flex flex-wrap gap-1">
                {suspect.phoneNumbers.map((p) => (
                  <span key={p} className="rounded bg-muted px-2 py-0.5 font-mono text-xs">
                    {p}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <Label>DOB</Label>
              <div className="mt-1 text-sm">{suspect.dob ? new Date(suspect.dob).toLocaleDateString("en-IN") : "—"}</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Criminal history</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {suspect.criminalHistory.length === 0 && <span className="text-muted-foreground">No prior record.</span>}
            {suspect.criminalHistory.map((c, i) => (
              <div key={i} className="rounded-md bg-muted/60 px-3 py-2">
                {c}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Quick actions</CardTitle>
          <CardDescription>Update score / role (audited in the backend).</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label>Kingpin score</Label>
            <Input
              type="number"
              defaultValue={suspect.kingpinScore}
              onBlur={(e) => void update({ kingpinScore: parseFloat(e.target.value) || 0 })}
            />
          </div>
          <div className="space-y-1">
            <Label>Role</Label>
            <select
              className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
              defaultValue={suspect.role}
              onChange={(e) => void update({ role: e.target.value as Suspect["role"] })}
            >
              <option value="KINGPIN">KINGPIN</option>
              <option value="BROKER">BROKER</option>
              <option value="EXECUTOR">EXECUTOR</option>
            </select>
          </div>
          <div className="flex items-end">
            <Button variant="outline" disabled={busy} onClick={() => void load()}>
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>
      {view}
    </div>
  );
}
