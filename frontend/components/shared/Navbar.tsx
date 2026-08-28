"use client";
import { LogOut, Shield } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

export function Navbar({ title }: { title?: string }) {
  const { logout, role } = useAuth();

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b bg-card/80 px-4 backdrop-blur md:px-6">
      <div className="flex items-center gap-2 md:hidden">
        <Shield className="h-6 w-6 text-accent" />
        <span className="font-bold">CrimeNetX</span>
      </div>
      <h1 className="text-sm font-semibold md:text-base">{title ?? "Command Dashboard"}</h1>
      <div className="ml-auto flex items-center gap-3">
        <span className="hidden rounded-full bg-secondary px-3 py-1 text-xs font-medium sm:inline-flex">{role}</span>
        <Button variant="outline" size="sm" onClick={() => void logout()}>
          <LogOut className="h-4 w-4" />
          Logout
        </Button>
      </div>
    </header>
  );
}
