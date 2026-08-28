/**
 * Zustand store — global case + alert state shared across dashboard pages.
 */
"use client";
import { create } from "zustand";
import type { Alert, NetworkPayload } from "@shared/types";

interface CaseStore {
  activeCaseId: string | null;
  network: NetworkPayload | null;
  networkLoading: boolean;
  alerts: Alert[];
  setActiveCaseId: (id: string | null) => void;
  setNetwork: (network: NetworkPayload | null) => void;
  setNetworkLoading: (loading: boolean) => void;
  upsertAlert: (alert: Alert) => void;
  markAlertResolved: (id: string) => void;
}

export const useCaseStore = create<CaseStore>((set) => ({
  activeCaseId: null,
  network: null,
  networkLoading: false,
  alerts: [],
  setActiveCaseId: (id) => set({ activeCaseId: id }),
  setNetwork: (network) => set({ network }),
  setNetworkLoading: (loading) => set({ networkLoading: loading }),
  upsertAlert: (alert) =>
    set((state) => ({
      alerts: [alert, ...state.alerts.filter((a) => a.id !== alert.id)].slice(0, 200),
    })),
  markAlertResolved: (id) =>
    set((state) => ({
      alerts: state.alerts.map((a) => (a.id === id ? { ...a, resolved: true } : a)),
    })),
}));
