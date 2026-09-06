"use client";
import { cn } from "@/lib/utils";
import { Bot, User, AlertTriangle } from "lucide-react";

interface Props {
  role: "user" | "assistant";
  content: string;
  intent?: string;
  streaming?: boolean;
}

// Very lightweight markdown-ish renderer (bold, bullets, headings)
function renderContent(text: string) {
  const lines = text.split("\n");
  return lines.map((line, i) => {
    if (line.startsWith("### ")) return <h3 key={i} className="mt-2 mb-1 text-sm font-bold text-primary">{line.slice(4)}</h3>;
    if (line.startsWith("## ")) return <h2 key={i} className="mt-2 mb-1 text-base font-bold">{line.slice(3)}</h2>;
    if (line.startsWith("# ")) return <h1 key={i} className="mt-2 mb-1 text-lg font-bold">{line.slice(2)}</h1>;
    if (line.startsWith("- ") || line.startsWith("* ")) {
      return <div key={i} className="ml-3 flex gap-2"><span>•</span><span>{formatInline(line.slice(2))}</span></div>;
    }
    if (line.trim().startsWith("⚠️ HYPOTHESIS")) {
      return (
        <div key={i} className="my-2 flex gap-2 rounded-md bg-yellow-50 border border-yellow-300 px-3 py-2 text-yellow-900 text-xs">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span>{formatInline(line)}</span>
        </div>
      );
    }
    return <p key={i} className="my-1">{formatInline(line)}</p>;
  });
}

function formatInline(text: string) {
  // **bold** support
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? (
      <strong key={i}>{p.slice(2, -2)}</strong>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}

export function ChatMessage({ role, content, intent, streaming }: Props) {
  const isUser = role === "user";
  return (
    <div className={cn("flex gap-3 py-3", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="h-8 w-8 flex-shrink-0 rounded-full bg-primary text-primary-foreground grid place-items-center">
          <Bot className="h-4 w-4" />
        </div>
      )}
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-2 text-sm leading-relaxed",
          isUser
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "bg-muted text-foreground rounded-bl-sm border"
        )}
      >
        {!isUser && intent && (
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Intent: {intent.replace(/_/g, " ")}
          </div>
        )}
        <div className="prose-sm">{renderContent(content)}</div>
        {streaming && (
          <span className="ml-1 inline-block h-3 w-1 animate-pulse bg-current align-middle" />
        )}
      </div>
      {isUser && (
        <div className="h-8 w-8 flex-shrink-0 rounded-full bg-accent text-accent-foreground grid place-items-center">
          <User className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}