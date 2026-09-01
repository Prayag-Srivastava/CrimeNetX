"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { Play, Pause, SkipBack, SkipForward, ShieldCheck, Clock, MapPin, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

export default function ExecutionSimulatorPage() {
  const params = useParams();
  const caseId = params?.id as string;

  const [loading, setLoading] = useState(true);
  const [simulation, setSimulation] = useState<any>(null);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    async function fetchSimulation() {
      try {
        const res = await api.get(`/cases/${caseId}/simulation`);
        if (res.data?.simulation) {
          setSimulation(res.data.simulation);
        }
      } catch (err) {
        console.error("Failed to load simulation", err);
      } finally {
        setLoading(false);
      }
    }
    if (caseId) fetchSimulation();
  }, [caseId]);

  // Auto-play timer
  useEffect(() => {
    let interval: any;
    if (isPlaying && simulation?.steps) {
      interval = setInterval(() => {
        setCurrentStepIdx((prev) => {
          if (prev >= simulation.steps.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [isPlaying, simulation]);

  if (loading) {
    return (
      <div className="p-8 text-slate-400 font-mono flex items-center gap-2">
        <Clock className="animate-spin h-5 w-5 text-emerald-500" />
        Generating AI Crime Scene Execution Reconstruction...
      </div>
    );
  }

  const steps = simulation?.steps || [];
  const activeStep = steps[currentStepIdx] || {};

  return (
    <div className="p-6 space-y-6 text-white bg-slate-950 min-h-screen">
      {/* Header */}
      <div className="flex justify-between items-center border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-emerald-400 flex items-center gap-2">
            <span>🎬</span> 2.5D Crime Execution Simulator
          </h1>
          <p className="text-xs text-slate-400 font-mono mt-1">
            Chronological evidence-backed timeline reconstruction
          </p>
        </div>
        <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5 rounded-full text-xs text-emerald-400 font-mono">
          <ShieldCheck className="h-4 w-4" /> AI Verified Reconstruction
        </div>
      </div>

      {/* Split Screen Grid */}
      <div className="grid grid-cols-12 gap-6 h-[520px]">
        {/* Left: Visual Map View (7 cols) */}
        <div className="col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between relative overflow-hidden bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px]">
          <div className="flex justify-between text-xs font-mono text-slate-400">
            <span>TACTICAL MAP CANVAS</span>
            <span className="text-emerald-400">
              STEP {currentStepIdx + 1} OF {steps.length}
            </span>
          </div>

          {/* Active Step Map Node Display */}
          <div className="my-auto text-center space-y-4 p-8 bg-slate-950/80 border border-slate-800 rounded-xl max-w-md mx-auto shadow-2xl">
            <div className="inline-flex p-3 rounded-full bg-emerald-500/20 text-emerald-400 mb-2 animate-pulse">
              <MapPin className="h-8 w-8" />
            </div>
            <div>
              <span className="text-xs font-mono text-emerald-400 uppercase tracking-widest">
                {activeStep.action_type || "ACTION"}
              </span>
              <h2 className="text-xl font-bold text-white mt-1">
                {activeStep.title || "Step Event"}
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                {activeStep.location_name}
              </p>
            </div>
            <div className="flex justify-center gap-2 pt-2">
              {activeStep.actors?.map((actor: string, idx: number) => (
                <span
                  key={idx}
                  className="bg-slate-800 text-slate-200 px-2.5 py-1 rounded text-xs font-mono border border-slate-700"
                >
                  👤 {actor}
                </span>
              ))}
            </div>
          </div>

          {/* Playback Controls Bar */}
          <div className="bg-slate-950 border border-slate-800 p-3 rounded-lg flex items-center justify-between">
            <span className="font-mono text-sm text-emerald-400 font-bold">
              ⏱️ {activeStep.time_label || "--:--"}
            </span>
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCurrentStepIdx((prev) => Math.max(0, prev - 1))}
                disabled={currentStepIdx === 0}
                className="border-slate-800"
              >
                <SkipBack className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                onClick={() => setIsPlaying(!isPlaying)}
                className="bg-emerald-600 hover:bg-emerald-500 font-bold px-6"
              >
                {isPlaying ? (
                  <Pause className="h-4 w-4 mr-1" />
                ) : (
                  <Play className="h-4 w-4 mr-1" />
                )}
                {isPlaying ? "PAUSE" : "PLAY"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setCurrentStepIdx((prev) => Math.min(steps.length - 1, prev + 1))
                }
                disabled={currentStepIdx === steps.length - 1}
                className="border-slate-800"
              >
                <SkipForward className="h-4 w-4" />
              </Button>
            </div>
            <span className="text-xs font-mono text-slate-500">3s / Step</span>
          </div>
        </div>

        {/* Right: Execution Log Sidebar (5 cols) */}
        <div className="col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-4 overflow-y-auto space-y-3">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider font-mono">
            Execution Log Sequence
          </h2>

          {steps.map((step: any, idx: number) => {
            const isActive = idx === currentStepIdx;
            return (
              <div
                key={idx}
                onClick={() => {
                  setCurrentStepIdx(idx);
                  setIsPlaying(false);
                }}
                className={`p-3.5 rounded-lg border cursor-pointer transition-all ${
                  isActive
                    ? "bg-slate-950 border-emerald-500 shadow-lg shadow-emerald-500/10"
                    : "bg-slate-950/40 border-slate-800/80 hover:border-slate-700 opacity-60"
                }`}
              >
                <div className="flex justify-between items-center text-xs font-mono mb-1">
                  <span
                    className={
                      isActive ? "text-emerald-400 font-bold" : "text-slate-400"
                    }
                  >
                    Phase {step.step_number} · {step.time_label}
                  </span>
                  <span className="text-[10px] text-slate-500 uppercase">
                    {step.action_type}
                  </span>
                </div>
                <h3 className="text-sm font-semibold text-slate-200">
                  {step.title}
                </h3>
                <p className="text-xs text-slate-400 mt-1 line-clamp-2">
                  {step.description}
                </p>
                <div className="flex items-center gap-1 text-[10px] text-slate-500 mt-2 font-mono">
                  <FileText className="h-3 w-3 text-emerald-500" /> Source:{" "}
                  {step.evidence_source}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}