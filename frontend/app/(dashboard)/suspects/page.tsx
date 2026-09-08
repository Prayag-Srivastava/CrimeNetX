"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { 
  Search, 
  Phone, 
  ArrowUpRight, 
  LayoutList, 
  LayoutGrid, 
  Users, 
  ShieldAlert,
  ChevronRight
} from "lucide-react";
import { api, extractErrorMessage } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import type { Suspect } from "@shared/types";

type ThreatTier = "ALL" | "CRITICAL" | "ASSOCIATE" | "MONITORED";

export default function SuspectsPage() {
  const [suspects, setSuspects] = useState<Suspect[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [tierFilter, setTierFilter] = useState<ThreatTier>("ALL");
  const [viewMode, setViewMode] = useState<"table" | "grid">("table");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ data: Suspect[] } | Suspect[]>("/suspects")
      .then((res) => {
        const list = Array.isArray(res.data) ? res.data : (res.data as any)?.data ?? [];
        setSuspects(list);
        setError(null);
      })
      .catch((err) => setError(extractErrorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return suspects.filter((s) => {
      const matchesQuery =
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.aliases?.some((a) => a.toLowerCase().includes(q)) ||
        s.phoneNumbers?.some((p) => p.includes(q)) ||
        (s.role && s.role.toLowerCase().includes(q));

      const score = s.kingpinScore ?? 0;
      const matchesTier =
        tierFilter === "ALL" ||
        (tierFilter === "CRITICAL" && score >= 70) ||
        (tierFilter === "ASSOCIATE" && score >= 40 && score < 70) ||
        (tierFilter === "MONITORED" && score < 40);

      return matchesQuery && matchesTier;
    });
  }, [suspects, query, tierFilter]);

  return (
    <div className="space-y-5">
      {/* PAGE HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Suspect Registry
            </h1>
            <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-700">
              {suspects.length} Profiles
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5 font-medium">
            Cross-case person-of-interest roster sorted by network centrality.
          </p>
        </div>

        {/* View Toggle */}
        <div className="flex items-center gap-1 self-start sm:self-auto bg-slate-100 p-0.5 rounded-lg border border-slate-200">
          <button
            onClick={() => setViewMode("table")}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition ${
              viewMode === "table"
                ? "bg-white text-slate-900 shadow-2xs font-semibold"
                : "text-slate-500 hover:text-slate-900"
            }`}
          >
            <LayoutList className="h-3.5 w-3.5" />
            <span>Table</span>
          </button>
          <button
            onClick={() => setViewMode("grid")}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition ${
              viewMode === "grid"
                ? "bg-white text-slate-900 shadow-2xs font-semibold"
                : "text-slate-500 hover:text-slate-900"
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            <span>Cards</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-mono text-rose-800">
          {error}
        </div>
      )}

      {/* UNIFIED FILTER CONSOLE */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
        {/* Search */}
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name, alias, phone, or role..."
            className="w-full rounded-lg border border-slate-200 bg-slate-50/50 pl-8 pr-3 py-1.5 text-xs font-mono text-slate-800 placeholder:text-slate-400 focus:bg-white focus:border-slate-400 focus:outline-none transition"
          />
        </div>

        {/* Threat Filter Segment */}
        <div className="flex flex-wrap items-center gap-1 font-mono text-[11px]">
          {[
            { id: "ALL", label: "All" },
            { id: "CRITICAL", label: "Threat ≥70%" },
            { id: "ASSOCIATE", label: "40%–69%" },
            { id: "MONITORED", label: "<40%" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setTierFilter(tab.id as ThreatTier)}
              className={`px-2.5 py-1 rounded-md transition ${
                tierFilter === tab.id
                  ? "bg-slate-900 text-white font-bold shadow-2xs"
                  : "bg-transparent text-slate-600 hover:bg-slate-100"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* SKELETON LOADER */}
      {loading && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-md" />
          ))}
        </div>
      )}

      {/* PRIMARY STRUCTURE: ORGANIZED TABLE VIEW */}
      {!loading && viewMode === "table" && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left font-sans text-xs">
              <thead className="border-b border-slate-200 bg-slate-50/75 text-[11px] font-semibold text-slate-500 uppercase tracking-wider font-mono">
                <tr>
                  <th className="py-3 px-4">Subject</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">Aliases</th>
                  <th className="py-3 px-4">Contact / Intercepts</th>
                  <th className="py-3 px-4">Threat Index</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filtered.map((s) => {
                  const score = s.kingpinScore ?? 0;
                  const isHigh = score >= 70;
                  const isMed = score >= 40 && score < 70;

                  return (
                    <tr
                      key={s.id}
                      className="hover:bg-slate-50/80 transition-colors group"
                    >
                      {/* Subject Name */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <Link
                          href={`/suspects/${s.id}`}
                          className="font-semibold text-slate-900 group-hover:text-purple-700 transition-colors inline-flex items-center gap-1"
                        >
                          <span>{s.name}</span>
                          <ArrowUpRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity text-slate-400" />
                        </Link>
                      </td>

                      {/* Role */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="font-mono text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700">
                          {s.role || "OPERATIVE"}
                        </span>
                      </td>

                      {/* Aliases */}
                      <td className="py-3 px-4 text-slate-500 font-mono text-xs max-w-[200px] truncate">
                        {s.aliases?.length > 0 ? s.aliases.join(", ") : "—"}
                      </td>

                      {/* Phone Numbers */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        {s.phoneNumbers?.length > 0 ? (
                          <div className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-600 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded">
                            <Phone className="h-2.5 w-2.5 text-slate-400 shrink-0" />
                            <span>{s.phoneNumbers[0]}</span>
                            {s.phoneNumbers.length > 1 && (
                              <span className="text-[10px] text-slate-400 ml-1">
                                +{s.phoneNumbers.length - 1}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-300 font-mono text-xs">—</span>
                        )}
                      </td>

                      {/* Threat Index Meter */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-2.5 max-w-[140px]">
                          <div className="h-1.5 flex-1 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full ${
                                isHigh ? "bg-rose-500" : isMed ? "bg-amber-500" : "bg-emerald-500"
                              }`}
                              style={{ width: `${Math.min(score, 100)}%` }}
                            />
                          </div>
                          <span
                            className={`font-mono text-xs font-bold tabular-nums ${
                              isHigh
                                ? "text-rose-700"
                                : isMed
                                ? "text-amber-800"
                                : "text-emerald-700"
                            }`}
                          >
                            {score.toFixed(0)}%
                          </span>
                        </div>
                      </td>

                      {/* Action */}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <Link
                          href={`/suspects/${s.id}`}
                          className="font-mono text-[11px] font-semibold text-slate-500 hover:text-slate-900 transition-colors inline-flex items-center gap-0.5"
                        >
                          <span>Dossier</span>
                          <ChevronRight className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SECONDARY STRUCTURE: CARD VIEW */}
      {!loading && viewMode === "grid" && (
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((s) => {
            const score = s.kingpinScore ?? 0;
            const isHigh = score >= 70;
            const isMed = score >= 40 && score < 70;

            return (
              <Link
                key={s.id}
                href={`/suspects/${s.id}`}
                className="group flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 transition-all hover:border-slate-300 hover:shadow-2xs"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-semibold text-sm text-slate-900 group-hover:text-purple-700 transition-colors block truncate">
                        {s.name}
                      </span>
                      <p className="text-xs text-slate-500 font-mono truncate mt-0.5">
                        {s.aliases?.length > 0 ? `aka ${s.aliases.join(", ")}` : "No recorded aliases"}
                      </p>
                    </div>

                    <span
                      className={`font-mono text-xs font-bold px-2 py-0.5 rounded border tabular-nums shrink-0 ${
                        isHigh
                          ? "bg-rose-50 text-rose-700 border-rose-200"
                          : isMed
                          ? "bg-amber-50 text-amber-800 border-amber-200"
                          : "bg-emerald-50 text-emerald-700 border-emerald-200"
                      }`}
                    >
                      {score.toFixed(0)}%
                    </span>
                  </div>

                  {s.phoneNumbers?.length > 0 && (
                    <div className="mt-3 flex items-center gap-1 font-mono text-[11px] text-slate-600 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded w-fit">
                      <Phone className="h-2.5 w-2.5 text-slate-400" />
                      <span>{s.phoneNumbers[0]}</span>
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-mono">
                  <span className="font-bold text-[10px] text-slate-600 uppercase tracking-wide">
                    {s.role || "OPERATIVE"}
                  </span>
                  <span className="text-slate-400 group-hover:text-slate-700 transition-colors flex items-center gap-0.5">
                    <span>Profile</span>
                    <ChevronRight className="h-3 w-3" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* EMPTY STATE */}
      {!loading && filtered.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-xs text-slate-500 font-mono">
          No suspects match the current filters.
        </div>
      )}
    </div>
  );
}