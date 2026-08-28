/**
 * useCase — data fetching for a single case (network, evidence, alerts, stats).
 */
"use client";
import { useCallback, useEffect, useState } from "react";
import { api, extractErrorMessage } from "@/lib/api";
import type { Alert, CaseSummary, Evidence, NetworkPayload, Suspect, Transaction } from "@shared/types";

export interface CaseBundle {
  caseData?: CaseSummary;
  network: NetworkPayload | null;
  evidence: Evidence[];
  alerts: Alert[];
  suspects: Suspect[];
  transactions: Transaction[];
  stats?: Record<string, number>;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useCase(caseId: string | undefined): CaseBundle {
  const [state, setState] = useState<Omit<CaseBundle, "refresh">>({
    network: null,
    evidence: [],
    alerts: [],
    suspects: [],
    transactions: [],
    loading: !!caseId,
    error: null,
  });

  const refresh = useCallback(async () => {
    if (!caseId) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [caseResp, networkResp, evidenceResp, alertResp, suspectResp, statsResp] = await Promise.all([
        api.get<CaseSummary>(`/cases/${caseId}`),
        api.get<NetworkPayload>(`/case/${caseId}/network`),
        api.get<{ data: Evidence[] }>(`/evidence/case/${caseId}`),
        api.get<{ data: Alert[] }>(`/alerts/case/${caseId}?limit=50`),
        api.get<{ data: Suspect[] }>(`/suspects?caseId=${caseId}`),
        api.get<Record<string, number>>(`/cases/${caseId}/stats`),
      ]);
      setState({
        caseData: caseResp.data,
        network: networkResp.data,
        evidence: evidenceResp.data.data,
        alerts: alertResp.data.data,
        suspects: suspectResp.data.data,
        transactions: [],
        stats: statsResp.data,
        loading: false,
        error: null,
      });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: extractErrorMessage(err) }));
    }
  }, [caseId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ...state, refresh };
}
