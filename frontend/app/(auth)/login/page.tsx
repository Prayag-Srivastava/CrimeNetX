"use client";
import { useState } from "react";
import Link from "next/link";
import { Shield } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await login(email, password);
    setBusy(false);
    if (result?.error) setError("Invalid credentials — check your email/password.");
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
            <CardTitle>Sign in</CardTitle>
            <CardDescription>Law enforcement access — credentials are issued by the administration.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="investigator@crimenetx.gov.in"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
              {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Signing in…" : "Sign in"}
              </Button>
            </form>
            <div className="mt-4 text-center text-sm text-muted-foreground">
              New officer?{" "}
              <Link href="/register" className="text-primary underline-offset-4 hover:underline">
                Request account
              </Link>
            </div>
            <div className="mt-4 rounded-md bg-muted p-3 text-xs text-muted-foreground">
              Demo credentials (all: <code>Test@1234</code>) — investigator@ / dsp@ / sp@ / dgp@crimenetx.gov.in
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
