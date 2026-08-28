"use client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ROLE_LABELS } from "@/lib/auth";

export default function SettingsPage() {
  const { user } = useAuth();

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h2 className="text-2xl font-bold">Settings</h2>

      <Card>
        <CardHeader>
          <CardTitle>Officer profile</CardTitle>
          <CardDescription>Your identity on the CrimeNetX network.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Name</span>
            <b>{user?.name}</b>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Email</span>
            <b>{user?.email}</b>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Role</span>
            <Badge variant="info">{user?.role ? ROLE_LABELS[user.role as keyof typeof ROLE_LABELS] : "—"}</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Department</span>
            <b>{user?.department || "—"}</b>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Badge number</span>
            <b className="font-mono">{user?.badgeNumber || "—"}</b>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Role permissions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {Object.entries(ROLE_LABELS).map(([role, label]) => (
            <div key={role} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
              <span>{label}</span>
              <span className="text-xs text-muted-foreground">
                {role === "INVESTIGATOR" && "Assigned cases · evidence · network"}
                {role === "DSP" && "+ District analytics · alert triage"}
                {role === "SP" && "+ Multi-district oversight · cross-reference"}
                {role === "DGP" && "+ State-wide KPIs · top kingpins"}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Environment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 font-mono text-xs text-muted-foreground">
          <div>API: {process.env.NEXT_PUBLIC_API_URL || "unset (defaults to :5000)"}</div>
          <div>AI API: {process.env.NEXT_PUBLIC_AI_API_URL || "unset (defaults to :8000)"}</div>
          <div>Socket: {process.env.NEXT_PUBLIC_SOCKET_URL || "unset (defaults to :5000)"}</div>
        </CardContent>
      </Card>
    </div>
  );
}
