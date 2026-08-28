"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Sidebar } from "@/components/shared/Sidebar";
import { Navbar } from "@/components/shared/Navbar";
import { RoleGuard } from "@/components/shared/RoleGuard";
import { useSocket } from "@/hooks/useSocket";
import { tokenStore } from "@/lib/api";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { status, data } = useSession();
  const router = useRouter();
  useSocket(); // real-time alert toasts

  useEffect(() => {
    if (status === "authenticated") {
      // Mirror NextAuth tokens into localStorage for the axios layer.
      const access = (data as { accessToken?: string } | null)?.accessToken;
      if (access) {
        tokenStore.set(access, tokenStore.getRefresh() ?? "");
      }
    }
    if (status === "unauthenticated") {
      router.replace("/login");
    }
  }, [status, data, router]);

  if (status === "loading" || status === "unauthenticated") {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <div className="text-sm text-muted-foreground">Authenticating…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="md:pl-64">
        <Navbar />
        <main className="p-4 md:p-6">
          <RoleGuard>{children}</RoleGuard>
        </main>
      </div>
    </div>
  );
}
