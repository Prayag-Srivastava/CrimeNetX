"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { usePathname } from "next/navigation";
import { MessageCircle, X, Trash2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { QuickActions } from "./QuickActions";
import { API_URL, tokenStore } from "@/lib/api";

interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
  intent?: string;
  streaming?: boolean;
}

export function InvestigatorChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pathname = usePathname();

  // Auto-detect current case from URL
  const caseIdMatch = pathname?.match(/\/cases\/([^/]+)/);
  const caseId = caseIdMatch ? caseIdMatch[1] : null;

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Reset when switching cases
  useEffect(() => {
    setConversationId(null);
    setMessages([]);
  }, [caseId]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || streaming) return;

      const userMsg: Msg = {
        id: `u-${Date.now()}`,
        role: "user",
        content: text,
      };
      const assistantMsg: Msg = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: "",
        streaming: true,
      };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setStreaming(true);

      const token = tokenStore.getAccess();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const resp = await fetch(`${API_URL}/chat/query`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            question: text,
            caseId,
            conversationId,
            history: messages
              .filter((m) => !m.streaming && m.content)
              .slice(-6)
              .map((m) => ({ role: m.role, content: m.content })),
          }),
          signal: controller.signal,
        });

        if (!resp.ok || !resp.body) {
          throw new Error(`HTTP ${resp.status}`);
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let accumulated = "";
        let intent = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";

          for (const part of parts) {
            const dataLine = part.split("\n").find((l) => l.startsWith("data: "));
            if (!dataLine) continue;
            try {
              const evt = JSON.parse(dataLine.slice(6));
              if (evt.type === "conversation" && evt.data?.conversationId) {
                setConversationId(evt.data.conversationId);
              } else if (evt.type === "intent") {
                intent = evt.data?.intent || "";
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsg.id ? { ...m, intent } : m
                  )
                );
              } else if (evt.type === "token" && evt.data?.text) {
                accumulated += evt.data.text;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsg.id ? { ...m, content: accumulated } : m
                  )
                );
              } else if (evt.type === "error") {
                accumulated += `\n\n⚠️ ${evt.data?.message || "Error"}`;
              }
            } catch { /* ignore malformed */ }
          }
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, streaming: false, content: accumulated || "(no response)" }
              : m
          )
        );
      } catch (err: any) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, streaming: false, content: `⚠️ Failed: ${err.message || err}` }
              : m
          )
        );
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [caseId, conversationId, messages, streaming]
  );

  const clearChat = () => {
    if (abortRef.current) abortRef.current.abort();
    setMessages([]);
    setConversationId(null);
    setStreaming(false);
  };

  return (
    <>
      {/* Floating trigger */}
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "fixed bottom-6 right-6 z-50 grid h-14 w-14 place-items-center rounded-full shadow-lg transition-all",
          open ? "bg-red-500 hover:bg-red-600" : "bg-primary hover:bg-primary/90"
        )}
        aria-label={open ? "Close chat" : "Open chat"}
      >
        {open ? <X className="h-6 w-6 text-white" /> : <MessageCircle className="h-6 w-6 text-white" />}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 flex h-[70vh] w-[95vw] max-w-md flex-col rounded-2xl border bg-background shadow-2xl md:w-[440px]">
          {/* Header */}
          <div className="flex items-center justify-between border-b bg-primary px-4 py-3 text-primary-foreground rounded-t-2xl">
            <div>
              <div className="text-sm font-semibold">CrimeNetX Assistant</div>
              <div className="text-[10px] opacity-80">
                {caseId ? `Scoped to case · ${caseId.slice(0, 8)}…` : "Global mode"}
              </div>
            </div>
            <div className="flex gap-1">
              <Button size="icon" variant="ghost" className="h-8 w-8 text-white hover:bg-white/10" onClick={clearChat}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3">
            {messages.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                <div className="grid h-12 w-12 place-items-center rounded-full bg-primary/10">
                  <MessageCircle className="h-6 w-6 text-primary" />
                </div>
                <div className="text-sm font-medium">Ask me anything about your investigation</div>
                <div className="text-xs text-muted-foreground">
                  {caseId
                    ? "I have full access to this case's FIR, network graph, suspects, CDR, and money trail."
                    : "Open a case to get case-specific answers, or ask general questions."}
                </div>
              </div>
            )}
            {messages.map((m) => (
              <ChatMessage
                key={m.id}
                role={m.role}
                content={m.content}
                intent={m.intent}
                streaming={m.streaming}
              />
            ))}
          </div>

          {messages.length === 0 && (
            <QuickActions hasCase={!!caseId} onPick={sendMessage} />
          )}

          <ChatInput onSend={sendMessage} disabled={streaming} streaming={streaming} />
        </div>
      )}
    </>
  );
}