"use client";
import { useState } from "react";
import Link from "next/link";
import { Shield } from "lucide-react";
import { api, extractErrorMessage } from "@/lib/api";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Role } from "@shared/types";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", password: "", department: "", badgeNumber: "", role: "INVESTIGATOR" as Role });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/register", form);
      router.push("/login?registered=1");
    } catch (err) {
      setError(extractErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-gradient-to-br from-[#0f1e3d] to-[#1a2b4a] p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2 text-white">
          <Shield className="h-8 w-8 text-amber-400" />
          <span className="text-2xl font-bold">
            Crime<span className="text-amber-400">Net</span>X
          </span>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Request officer account</CardTitle>
            <CardDescription>Registration requires administrative approval in production.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
              <div className="space-y-1.5">
                <Label>Full name</Label>
                <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Password (min 8)</Label>
                <Input type="password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Department</Label>
                  <Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="Pune City" />
                </div>
                <div className="space-y-1.5">
                  <Label>Badge number</Label>
                  <Input value={form.badgeNumber} onChange={(e) => setForm({ ...form, badgeNumber: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as Role })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["INVESTIGATOR", "DSP", "SP", "DGP"] as Role[]).map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Creating…" : "Create account"}
              </Button>
            </form>
            <div className="mt-4 text-center text-sm text-muted-foreground">
              Already registered?{" "}
              <Link href="/login" className="text-primary underline-offset-4 hover:underline">
                Sign in
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
