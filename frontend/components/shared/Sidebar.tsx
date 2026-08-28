"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FolderOpen,
  Users,
  GitBranch,
  Bell,
  Settings,
  Shield,
  Search,
  FileText,
  BarChart3,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import type { Role } from "@shared/types";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  minRole: Role;
}

const NAV: NavItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: <LayoutDashboard className="h-4 w-4" />,
    minRole: "INVESTIGATOR",
  },
  {
    href: "/cases",
    label: "Cases",
    icon: <FolderOpen className="h-4 w-4" />,
    minRole: "INVESTIGATOR",
  },
  {
    href: "/suspects",
    label: "Suspects",
    icon: <Users className="h-4 w-4" />,
    minRole: "INVESTIGATOR",
  },
  {
    href: "/cross-reference",
    label: "Cross-Reference",
    icon: <Search className="h-4 w-4" />,
    minRole: "SP",
  },
  {
    href: "/alerts",
    label: "Alerts",
    icon: <Bell className="h-4 w-4" />,
    minRole: "DSP",
  },
  {
    href: "/settings",
    label: "Settings",
    icon: <Settings className="h-4 w-4" />,
    minRole: "INVESTIGATOR",
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { role, user } = useAuth();
  if (!role) return null;

  const ROLE_LEVELS: Record<Role, number> = { INVESTIGATOR: 1, DSP: 2, SP: 3, DGP: 4 };

  const visible = NAV.filter((item) => ROLE_LEVELS[role] >= ROLE_LEVELS[item.minRole]);

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r bg-primary text-primary-foreground md:flex">
      <div className="flex h-16 items-center gap-2 border-b border-white/10 px-5">
        <Shield className="h-7 w-7 text-accent" />
        <div>
          <div className="text-base font-bold tracking-tight">CrimeNetX</div>
          <div className="text-[10px] uppercase tracking-widest text-white/50">SIH26189</div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {visible.map((item) => {
          const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                active ? "bg-white/15 text-white" : "text-white/70 hover:bg-white/10 hover:text-white"
              )}
            >
              {item.icon}
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-white/10 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-sm font-bold">
            {user?.name?.slice(0, 1) ?? "U"}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{user?.name}</div>
            <div className="truncate text-xs text-white/50">{role}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
