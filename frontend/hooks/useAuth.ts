/**
 * useAuth — session + role helpers built on NextAuth.
 */
"use client";
import { useSession, signIn, signOut, getSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import type { Role } from "@shared/types";
import { ROLE_LEVELS } from "@/lib/auth";
import { tokenStore } from "@/lib/api";

export interface AuthUser {
  id?: string;
  name?: string | null;
  email?: string | null;
  role?: Role;
  department?: string;
  badgeNumber?: string;
}

export function useAuth() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const user = (session?.user as AuthUser | undefined) ?? null;
  const role = user?.role ?? null;

  const login = useCallback(
  async (email: string, password: string) => {
    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (result?.ok) {
      const session = await getSession();

      const accessToken = (session as { accessToken?: string } | null)?.accessToken;
      const refreshToken = (session as { refreshToken?: string } | null)?.refreshToken;

      if (accessToken && refreshToken) {
        tokenStore.set(accessToken, refreshToken);
      }

      router.push("/dashboard");
      router.refresh();
    }

    return result;
  },
  [router]
);

  const logout = useCallback(async () => {
    await signOut({ redirect: false });
    router.push("/login");
    router.refresh();
  }, [router]);

  const hasRole = useCallback(
    (minRole: Role) => (role ? ROLE_LEVELS[role] >= ROLE_LEVELS[minRole] : false),
    [role]
  );

  return { user, role, status, isAuthenticated: status === "authenticated", isLoading: status === "loading", login, logout, hasRole };
}
