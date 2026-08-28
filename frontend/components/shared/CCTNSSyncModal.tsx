"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RefreshCw, CheckCircle2, ShieldCheck, Server } from "lucide-react";
import { api } from "@/lib/api";

export function CCTNSSyncModal({ onSyncComplete }: { onSyncComplete?: () => void }) {
  const [open, setOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [completed, setCompleted] = useState(false);

  const startSync = async () => {
    setSyncing(true);
    setProgress(10);
    setLogs(["Connecting to NCRB CCTNS National Hub..."]);
    setCompleted(false);

    setTimeout(() => {
      setProgress(35);
      setLogs((prev) => [...prev, "Authenticating State Node (Maharashtra Gateway)..."]);
    }, 1000);

    setTimeout(() => {
      setProgress(65);
      setLogs((prev) => [...prev, "Fetching e-FIR streams registered in last 24h..."]);
    }, 2200);

    try {
      const res = await api.post("/cases/cctns-sync");
      setTimeout(() => {
        setProgress(100);
        setLogs((prev) => [
          ...prev,
          `Sync Successful! Ingested ${res.data.casesSynced} new FIRs into CrimeNetX.`,
          "NLP Entity extraction and Graph linking completed.",
        ]);
        setSyncing(false);
        setCompleted(true);
        if (onSyncComplete) onSyncComplete();
      }, 3500);
    } catch (err) {
      setSyncing(false);
      setLogs((prev) => [...prev, "Sync Error: Could not reach gateway."]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10">
          <RefreshCw className="h-4 w-4 text-emerald-500 animate-spin-slow" />
          Sync CCTNS / ICJS
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-slate-900 border-slate-800 text-white max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-semibold text-emerald-400">
            <ShieldCheck className="h-6 w-6" />
            NCRB CCTNS Live Data Gateway
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-3">
          <div className="flex items-center justify-between text-xs text-slate-400 bg-slate-950 p-3 rounded-lg border border-slate-800">
            <span className="flex items-center gap-1.5"><Server className="h-3.5 w-3.5 text-emerald-500" /> Gateway: Live</span>
            <span>Protocol: HTTPS / REST API v2</span>
          </div>

          <div className="space-y-2">
            <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-slate-400">
              <span>Progress</span>
              <span>{progress}%</span>
            </div>
          </div>

          <div className="bg-slate-950 p-3 rounded-md border border-slate-800 h-36 overflow-y-auto text-xs font-mono space-y-1.5 text-slate-300">
            {logs.length === 0 && <p className="text-slate-500">Click start to initiate data pipeline sync...</p>}
            {logs.map((log, idx) => (
              <p key={idx} className="flex items-center gap-2">
                <span className="text-emerald-500">›</span> {log}
              </p>
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            {!completed ? (
              <Button onClick={startSync} disabled={syncing} className="bg-emerald-600 hover:bg-emerald-500">
                {syncing ? "Syncing..." : "Start CCTNS Sync"}
              </Button>
            ) : (
              <Button onClick={() => setOpen(false)} className="bg-slate-800 hover:bg-slate-700">
                <CheckCircle2 className="h-4 w-4 mr-2 text-emerald-400" /> Done
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}