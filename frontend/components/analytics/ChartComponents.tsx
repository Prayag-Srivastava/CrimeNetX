"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";
import type { CaseStatus, CasePriority } from "@shared/types";

const STATUS_COLORS: Record<string, string> = {
  OPEN: "#3b82f6",
  UNDER_INVESTIGATION: "#f59e0b",
  PENDING_REVIEW: "#8b5cf6",
  CLOSED: "#10b981",
  COLD: "#64748b",
};
const PRIORITY_COLORS: Record<string, string> = {
  LOW: "#10b981",
  MEDIUM: "#f59e0b",
  HIGH: "#ef4444",
  CRITICAL: "#7f1d1d",
};

export function StatusPie({ data }: { data: { status: CaseStatus; count: number }[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cases by Status</CardTitle>
      </CardHeader>
      <CardContent className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="count" nameKey="status" outerRadius={80} label>
              {data.map((d) => (
                <Cell key={d.status} fill={STATUS_COLORS[d.status] ?? "#94a3b8"} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export function PriorityBar({ data }: { data: { priority: CasePriority; count: number }[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cases by Priority</CardTitle>
      </CardHeader>
      <CardContent className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <XAxis dataKey="priority" />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
              {data.map((d) => (
                <Cell key={d.priority} fill={PRIORITY_COLORS[d.priority] ?? "#94a3b8"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
