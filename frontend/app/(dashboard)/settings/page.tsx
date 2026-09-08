"use client";

import { useAuth } from "@/hooks/useAuth";
import { ROLE_LABELS } from "@/lib/auth";
import { 
  User, 
  ShieldCheck, 
  Shield, 
  Server, 
  Mail, 
  Building2, 
  Hash, 
  KeyRound, 
  Terminal,
  CheckCircle2
} from "lucide-react";

export default function SettingsPage() {
  const { user } = useAuth();

  const userInitials = user?.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "ID";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* 1. PAGE HEADER */}
      <div className="border-b border-slate-200 pb-4">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            System Settings & Identity
          </h1>
          <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-700">
            Node Authentication
          </span>
        </div>
        <p className="text-xs text-slate-500 mt-0.5 font-medium">
          Officer credentials, role-based clearance tier, and network endpoints.
        </p>
      </div>

      {/* 2. OFFICER IDENTITY PROFILE CARD */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
        <div className="border-b border-slate-100 p-4 sm:px-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-purple-600" />
            <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-slate-900">
              Officer Profile Record
            </h2>
          </div>
          <span className="font-mono text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
            AUTHENTICATED
          </span>
        </div>

        <div className="p-4 sm:p-5">
          {/* Top Identity Monogram Header */}
          <div className="flex items-center gap-3.5 pb-4 border-b border-slate-100">
            <div className="h-11 w-11 rounded-lg bg-slate-900 text-white flex items-center justify-center font-mono text-sm font-bold shadow-2xs">
              {userInitials}
            </div>
            <div>
              <div className="text-sm font-bold text-slate-900">
                {user?.name || "Unidentified Officer"}
              </div>
              <div className="text-xs text-slate-500 font-mono">
                {user?.email || "No email bound"}
              </div>
            </div>
          </div>

          {/* Details Grid */}
          <div className="grid divide-y divide-slate-100 text-xs font-mono pt-1">
            <div className="flex items-center justify-between py-2.5">
              <span className="text-slate-500 flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5 text-slate-400" />
                <span>Statutory Clearance Role</span>
              </span>
              <span className="font-bold text-sky-800 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded text-[11px] uppercase">
                {user?.role ? ROLE_LABELS[user.role as keyof typeof ROLE_LABELS] : "—"}
              </span>
            </div>

            <div className="flex items-center justify-between py-2.5">
              <span className="text-slate-500 flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5 text-slate-400" />
                <span>Department / Division</span>
              </span>
              <span className="font-semibold text-slate-800">
                {user?.department || "—"}
              </span>
            </div>

            <div className="flex items-center justify-between py-2.5">
              <span className="text-slate-500 flex items-center gap-1.5">
                <Hash className="h-3.5 w-3.5 text-slate-400" />
                <span>Police Badge Identifier</span>
              </span>
              <span className="font-bold text-slate-900 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded">
                {user?.badgeNumber || "—"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. STATUTORY ROLE CLEARANCE HIERARCHY */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
        <div className="border-b border-slate-100 p-4 sm:px-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-purple-600" />
            <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-slate-900">
              Role Access Control Matrix
            </h2>
          </div>
          <span className="font-mono text-[10px] text-slate-400">
            HIERARCHICAL CLEARANCE
          </span>
        </div>

        <div className="divide-y divide-slate-100">
          {Object.entries(ROLE_LABELS).map(([role, label]) => {
            const isUserRole = user?.role === role;

            return (
              <div
                key={role}
                className={`flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 p-3.5 sm:px-5 transition-colors ${
                  isUserRole ? "bg-slate-50/90" : "hover:bg-slate-50/50"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-slate-900">
                    {label}
                  </span>
                  {isUserRole && (
                    <span className="inline-flex items-center gap-1 font-mono text-[10px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-1.5 py-0.2 rounded">
                      <CheckCircle2 className="h-2.5 w-2.5 text-emerald-600" /> Current Level
                    </span>
                  )}
                </div>

                <div className="text-xs text-slate-500 font-mono">
                  {role === "INVESTIGATOR" && "Assigned cases · evidence · network"}
                  {role === "DSP" && "+ District analytics · alert triage"}
                  {role === "SP" && "+ Multi-district oversight · cross-reference"}
                  {role === "DGP" && "+ State-wide KPIs · top kingpins"}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 4. NETWORK ENDPOINTS & TELEMETRY */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
        <div className="border-b border-slate-100 p-4 sm:px-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-purple-600" />
            <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-slate-900">
              Environment & Node Connectivity
            </h2>
          </div>
          <span className="font-mono text-[10px] text-slate-400">
            ACTIVE SERVICE BOUNDS
          </span>
        </div>

        <div className="p-4 sm:p-5 bg-slate-50/50">
          <div className="space-y-2 font-mono text-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2">
              <span className="text-slate-500 text-[11px] uppercase font-semibold">Core API Gateway</span>
              <span className="font-bold text-slate-800">
                {process.env.NEXT_PUBLIC_API_URL || "unset (defaults to :5000)"}
              </span>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2">
              <span className="text-slate-500 text-[11px] uppercase font-semibold">AI Reasoning Service</span>
              <span className="font-bold text-slate-800">
                {process.env.NEXT_PUBLIC_AI_API_URL || "unset (defaults to :8000)"}
              </span>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2">
              <span className="text-slate-500 text-[11px] uppercase font-semibold">Live Telemetry Socket</span>
              <span className="font-bold text-slate-800">
                {process.env.NEXT_PUBLIC_SOCKET_URL || "unset (defaults to :5000)"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}