"use client";
import { Button } from "@/components/ui/button";
import { Zap, Users, DollarSign, Search, MessageSquare } from "lucide-react";

interface Props {
  hasCase: boolean;
  onPick: (q: string) => void;
}

const CASE_ACTIONS = [
  { icon: <Users className="h-3 w-3" />, label: "Who is the kingpin?", q: "Who is the most likely kingpin of this case and why?" },
  { icon: <DollarSign className="h-3 w-3" />, label: "Money trail", q: "Trace the money trail in this case and flag any laundering risks." },
  { icon: <Zap className="h-3 w-3" />, label: "How was crime executed?", q: "Reconstruct step-by-step how this crime was likely planned and executed." },
  { icon: <Search className="h-3 w-3" />, label: "Similar cases", q: "Find similar historical cases that may be linked to this one." },
  { icon: <MessageSquare className="h-3 w-3" />, label: "Interrogation prep", q: "What contradictions should I press on when interrogating the top suspect?" },
];

const GLOBAL_ACTIONS = [
  { icon: <Zap className="h-3 w-3" />, label: "What can you do?", q: "What can you help me with?" },
  { icon: <Search className="h-3 w-3" />, label: "Find kingpins across cases", q: "Which suspects across all my cases have the highest kingpin scores?" },
];

export function QuickActions({ hasCase, onPick }: Props) {
  const actions = hasCase ? CASE_ACTIONS : GLOBAL_ACTIONS;
  return (
    <div className="flex flex-wrap gap-1.5 px-3 pb-2">
      {actions.map((a) => (
        <Button
          key={a.label}
          size="sm"
          variant="outline"
          className="h-7 gap-1 rounded-full px-2.5 text-[11px]"
          onClick={() => onPick(a.q)}
        >
          {a.icon}
          {a.label}
        </Button>
      ))}
    </div>
  );
}