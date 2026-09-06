"use client";
import { useState, KeyboardEvent } from "react";
import { Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
  streaming?: boolean;
}

export function ChatInput({ onSend, disabled, streaming }: Props) {
  const [value, setValue] = useState("");

  const send = () => {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue("");
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="border-t bg-background p-3">
      <div className="flex items-end gap-2">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKey}
          rows={2}
          placeholder={streaming ? "Assistant is responding…" : "Ask about this case, suspects, money flow, crime theory…"}
          disabled={disabled}
          className="flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
        />
        <Button size="icon" onClick={send} disabled={disabled || !value.trim()}>
          {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground">Enter to send · Shift+Enter for newline</div>
    </div>
  );
}