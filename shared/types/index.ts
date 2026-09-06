/**
 * CrimeNetX shared TypeScript contracts.
 * Mirrors the Node backend's Prisma models so the frontend stays in sync.
 */
export type Role = "INVESTIGATOR" | "DSP" | "SP" | "DGP";
export type CaseStatus = "OPEN" | "UNDER_INVESTIGATION" | "PENDING_REVIEW" | "CLOSED" | "COLD";
export type CasePriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type EntityType = "PERSON" | "LOCATION" | "PHONE" | "VEHICLE" | "ORGANIZATION" | "BANK_ACCOUNT" | "DATE" | "ALIAS";
export type GraphRole = "KINGPIN" | "BROKER" | "EXECUTOR";
export type RelationType = "phone_call" | "financial_transfer" | "family" | "associate" | "same_organization" | "co_location";
export type EvidenceType = "FIR" | "CDR" | "BANK" | "PHOTO" | "DOCUMENT" | "CCTV";
export type AlertType = "ANOMALY" | "HIGH_RISK" | "GHOST_LINK" | "CROSS_REFERENCE" | "NETWORK_UPDATE" | "EVIDENCE_UPLOAD" | "LAUNDERING_RISK";
export type AlertSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  department: string;
  badgeNumber: string;
  createdAt?: string;
}

export interface CaseSummary {
  id: string;
  caseNumber: string;
  title: string;
  description: string;
  status: CaseStatus;
  priority: CasePriority;
  jurisdiction: string;
  assignedInvestigatorId?: string;
  assignedInvestigator?: Pick<User, "id" | "name" | "email">;
  startDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface Entity {
  id: string;
  caseId: string;
  type: EntityType;
  value: string;
  confidence: number;
  extractedFrom: string;
  layer: string;
  createdAt: string;
}

export interface NetworkNode {
  id: string;
  caseId: string;
  entityId?: string | null;
  label: string;
  x: number;
  y: number;
  kingpinScore: number;
  role: GraphRole;
  centrality?: Record<string, number> | null;
  createdAt: string;
}

export interface NetworkEdge {
  id: string;
  caseId: string;
  sourceId: string;
  targetId: string;
  relationType: RelationType;
  weight: number;
  evidence: string;
  createdAt: string;
}

export interface NetworkPayload {
  caseId: string;
  upto: string | null;
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  metrics: { node_count: number; edge_count: number; kingpins: string[] };
}

export interface Evidence {
  id: string;
  caseId: string;
  type: EvidenceType;
  fileName: string;
  s3Url: string;
  sha256Hash: string;
  uploadedBy: string;
  uploader?: Pick<User, "id" | "name" | "email"> | null;
  gpsLat?: number | null;
  gpsLng?: number | null;
  capturedAt?: string | null;
  uploadedAt: string;
}

export interface Alert {
  id: string;
  caseId: string;
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  data?: Record<string, unknown> | null;
  resolved: boolean;
  createdAt: string;
}

export interface Suspect {
  id: string;
  name: string;
  aliases: string[];
  dob?: string | null;
  gender: string;
  address: string;
  phoneNumbers: string[];
  photoUrl: string;
  criminalHistory: string[];
  kingpinScore: number;
  role: GraphRole;
}

export interface Transaction {
  id: string;
  caseId: string;
  fromAccount: string;
  toAccount: string;
  amount: number;
  timestamp: string;
  transactionType: string;
  riskScore: number;
}

export interface DashboardKpis {
  totalCases: number;
  openCases: number;
  highPriority: number;
  suspects: number;
  evidenceCount: number;
  unresolvedAlerts: number;
  kingpins: number;
}

export interface DashboardPayload {
  role: Role;
  kpis: DashboardKpis;
  byStatus: { status: CaseStatus; count: number }[];
  byPriority: { priority: CasePriority; count: number }[];
  generatedAt: string;
}

export interface LinkPrediction {
  source: string;
  target: string;
  source_label?: string;
  target_label?: string;
  score: number;
  algorithm: string;
  rationale: string;
}

export interface CrossReferenceMatch {
  caseId: string;
  caseNumber: string;
  score: number;
  matchedEntities: string[];
  matchedReason: string;
}

// ---------------------------------------------------------------------------
// Chatbot
// ---------------------------------------------------------------------------
export type ChatMessageRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: ChatMessageRole;
  content: string;
  intent?: string;
  createdAt: string;
}

export interface ChatConversation {
  id: string;
  userId: string;
  caseId?: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages?: ChatMessage[];
  _count?: { messages: number };
}

export type ChatStreamEventType =
  | "conversation"
  | "intent"
  | "context"
  | "token"
  | "citation"
  | "done"
  | "error";

export interface ChatStreamEvent {
  type: ChatStreamEventType;
  data: Record<string, any>;
}