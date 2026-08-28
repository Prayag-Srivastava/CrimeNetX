import Link from "next/link";
import { ArrowRight, GitBranch, Shield, Sparkles } from "lucide-react";

export default function LandingPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-gradient-to-br from-[#0f1e3d] via-[#16294f] to-[#1a2b4a] text-white">
      {/* decorative grid */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      <div className="relative mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-6 py-16 text-center">
        <div className="mb-6 flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-xs uppercase tracking-widest">
          <Shield className="h-3.5 w-3.5 text-amber-400" />
          Smart India Hackathon 2026 · SIH26189
        </div>
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-6xl">
          Crime<span className="text-amber-400">Net</span>X
        </h1>
        <p className="mt-4 max-w-2xl text-base text-white/70 sm:text-lg">
          AI-powered Criminal Network Analysis System for the Ministry of Home Affairs. Ingest unstructured
          crime data, uncover hidden kingpins, trace money trails, and generate court-admissible dossiers.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-lg bg-amber-400 px-6 py-3 text-sm font-semibold text-slate-900 shadow-lg transition hover:bg-amber-300"
          >
            Enter Command Center <ArrowRight className="h-4 w-4" />
          </Link>
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-white/25 bg-white/5 px-6 py-3 text-sm font-medium transition hover:bg-white/10"
          >
            Documentation
          </a>
        </div>

        <div className="mt-14 grid w-full max-w-4xl grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            { icon: <GitBranch className="h-5 w-5 text-emerald-400" />, title: "Network Intelligence", desc: "PageRank, Betweenness & ghost-link prediction to expose hidden cells." },
            { icon: <Sparkles className="h-5 w-5 text-sky-400" />, title: "Multi-Agent AI", desc: "LangGraph supervisor orchestrates NLP, anomaly & kingpin agents in real time." },
            { icon: <Shield className="h-5 w-5 text-rose-400" />, title: "Chain of Custody", desc: "SHA-256 hashing, RBAC, audit logs and court-ready PDF dossiers." },
          ].map((f) => (
            <div key={f.title} className="rounded-xl border border-white/10 bg-white/5 p-5 text-left backdrop-blur">
              <div className="mb-2">{f.icon}</div>
              <div className="font-semibold">{f.title}</div>
              <div className="mt-1 text-sm text-white/60">{f.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
