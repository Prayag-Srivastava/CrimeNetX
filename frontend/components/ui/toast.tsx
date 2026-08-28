"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

export function useToast() {
  const [toasts, setToasts] = React.useState<{ id: number; title: string; description?: string; variant?: "default" | "destructive" }[]>([]);

  const toast = React.useCallback(
    (title: string, description?: string, variant: "default" | "destructive" = "default") => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t, { id, title, description, variant }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
    },
    []
  );

  const view = toasts.length > 0 && (
    <div className="fixed bottom-4 right-4 z-[9998] flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "rounded-lg border px-4 py-3 text-sm shadow-lg",
            t.variant === "destructive" ? "border-red-500 bg-red-50 text-red-900" : "border-border bg-card"
          )}
        >
          <div className="font-semibold">{t.title}</div>
          {t.description && <div className="mt-0.5 text-muted-foreground">{t.description}</div>}
        </div>
      ))}
    </div>
  );

  return { toast, view };
}
