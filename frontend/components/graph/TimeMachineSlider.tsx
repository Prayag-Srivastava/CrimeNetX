"use client";
/**
 * TimeMachineSlider — scrubs the investigation timeline. The parent refetches
 * GET /api/cases/:id/network?upto=<timestamp> as the value changes.
 */
import { Slider } from "@/components/ui/slider";
import { formatDate } from "@/lib/utils";

export function TimeMachineSlider({
  min,
  max,
  value,
  onChange,
}: {
  min: Date;
  max: Date;
  value: Date;
  onChange: (date: Date) => void;
}) {
  const minMs = min.getTime();
  const maxMs = max.getTime();
  const currentMs = Math.min(Math.max(value.getTime(), minMs), maxMs);
  const pct = maxMs > minMs ? ((currentMs - minMs) / (maxMs - minMs)) * 100 : 0;

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">⏱ Time-Machine Playback</div>
          <div className="text-xs text-muted-foreground">Scrub the network evolution</div>
        </div>
        <div className="rounded-md bg-primary px-3 py-1 font-mono text-xs text-primary-foreground">
          {formatDate(value)}
        </div>
      </div>
      <Slider
        min={minMs}
        max={maxMs}
        step={(maxMs - minMs) / 200 || 1}
        value={[currentMs]}
        onValueChange={([v]) => v && onChange(new Date(v))}
      />
      <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
        <span>{formatDate(min)}</span>
        <span>{pct.toFixed(0)}% of case timeline</span>
        <span>{formatDate(max)}</span>
      </div>
    </div>
  );
}
