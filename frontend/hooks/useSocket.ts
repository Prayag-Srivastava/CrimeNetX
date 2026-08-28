/**
 * useSocket — subscribes to real-time CrimeNetX alerts and toasts them.
 */
"use client";
import { useEffect } from "react";
import { connectSocket, disconnectSocket, onSocketEvent, type AlertPayload } from "@/lib/socket";
import { useCaseStore } from "@/store/caseStore";

const SEVERITY_STYLE: Record<string, string> = {
  CRITICAL: "bg-red-600 text-white",
  HIGH: "bg-orange-500 text-white",
  MEDIUM: "bg-yellow-500 text-black",
  LOW: "bg-slate-500 text-white",
  INFO: "bg-slate-700 text-white",
};

export function useSocket() {
  const upsertAlert = useCaseStore((s) => s.upsertAlert);

  useEffect(() => {
    const socket = connectSocket();

    const offs = [
      onSocketEvent("alert_created", (payload: AlertPayload) => {
        const alert = {
          id: String(payload.id ?? crypto.randomUUID()),
          caseId: String(payload.caseId ?? ""),
          type: String(payload.type ?? "ANOMALY"),
          severity: String(payload.severity ?? "INFO"),
          message: String(payload.message ?? "New alert"),
          resolved: false,
          createdAt: String(payload.createdAt ?? new Date().toISOString()),
        } as never;
        upsertAlert(alert);
        showToast(alert);
      }),
      onSocketEvent("high_risk_alert", (payload: AlertPayload) => {
        showToast(payload, "🚨");
      }),
      onSocketEvent("new_evidence_uploaded", (payload: AlertPayload) => {
        showToast(payload, "📎");
      }),
      onSocketEvent("network_updated", (payload: AlertPayload) => {
        showToast(payload, "🕸️");
      }),
      onSocketEvent("ghost_link_detected", (payload: AlertPayload) => {
        showToast(payload, "👻");
      }),
      onSocketEvent("cross_reference_match", (payload: AlertPayload) => {
        showToast(payload, "🔗");
      }),
    ];

    return () => {
      offs.forEach((off) => off());
      disconnectSocket();
    };
  }, [upsertAlert]);

  return null;
}

let toastContainer: HTMLDivElement | null = null;

function showToast(payload: AlertPayload, icon = "🔔") {
  if (typeof document === "undefined") return;
  if (!toastContainer) {
    toastContainer = document.createElement("div");
    toastContainer.className = "fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm";
    document.body.appendChild(toastContainer);
  }
  const el = document.createElement("div");
  const severity = String(payload.severity ?? "INFO");
  el.className = `${SEVERITY_STYLE[severity] ?? SEVERITY_STYLE.INFO} rounded-lg shadow-lg px-4 py-3 text-sm animate-in slide-in-from-bottom-2`;
  el.innerHTML = `<div class="font-semibold">${icon} ${(payload.type ?? "Alert").replace(/_/g, " ")}</div><div>${payload.message ?? ""}</div>`;
  toastContainer.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transition = "opacity 300ms";
    setTimeout(() => el.remove(), 320);
  }, 6000);
}
