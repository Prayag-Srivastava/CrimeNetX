/**
 * NextAuth route handler — Credentials provider backed by the Node backend.
 * Session carries the user object + JWT for API calls.
 */
import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import axios from "axios";

const API_URL =
  process.env.INTERNAL_API_URL || "http://backend-node:5000/api";

const handler = NextAuth({
  secret: process.env.NEXTAUTH_SECRET,

  session: {
    strategy: "jwt",
    maxAge: 7 * 24 * 60 * 60,
  },

  pages: {
    signIn: "/login",
  },

  providers: [
    CredentialsProvider({
      name: "Credentials",

      credentials: {
        email: {
          label: "Email",
          type: "email",
        },
        password: {
          label: "Password",
          type: "password",
        },
      },

      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        try {
          const { data } = await axios.post(`${API_URL}/auth/login`, {
            email: credentials.email,
            password: credentials.password,
          });

          return {
            id: data.user.id,
            email: data.user.email,
            name: data.user.name,
            role: data.user.role,
            department: data.user.department,
            badgeNumber: data.user.badgeNumber,
            accessToken: data.accessToken,
            refreshToken: data.refreshToken,
          };
        } catch {
          return null;
        }
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.user = user;
        token.accessToken = (
          user as { accessToken?: string }
        ).accessToken;
        token.refreshToken = (
          user as { refreshToken?: string }
        ).refreshToken;
      }

      return token;
    },

    async session({ session, token }) {
      session.user = token.user as typeof session.user;

      (session as { accessToken?: string }).accessToken =
        token.accessToken as string;

      (session as { refreshToken?: string }).refreshToken =
        token.refreshToken as string;

      return session;
    },
  },
});

export { handler as GET, handler as POST };