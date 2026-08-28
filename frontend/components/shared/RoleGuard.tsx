"use client";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { routeMinRoles } from "@/lib/auth";
import type { Role } from "@shared/types";
import { ROLE_LEVELS } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";

/**
 * RBAC guard for the frontend — blocks UI sections the user's role can't see.
 */
export function RoleGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { role } = useAuth();

  if (!role) return <>{children}</>;

  const matched = routeMinRoles.find((r) => pathname.startsWith(r.prefix));
  if (matched) {
    const allowed = ROLE_LEVELS[role as Role] >= ROLE_LEVELS[matched.minRole];
    if (!allowed) {
      return (
        <div className="grid place-items-center p-12">
          <Card className="max-w-md text-center">
            <CardContent className="p-8">
              <div className="text-4xl">🔒</div>
              <h2 className="mt-3 text-lg font-semibold">Access restricted</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                This section requires {matched.minRole} clearance or higher. Your role ({role}) does not have permission.
              </p>
            </CardContent>
          </Card>
        </div>
      );
    }
  }
  return <>{children}</>;
}
