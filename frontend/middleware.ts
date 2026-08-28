import { withAuth } from "next-auth/middleware";

export default withAuth(
  function middleware() {
    return;
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        const pathname = req.nextUrl.pathname;

        // Login/register are public.
        if (pathname === "/login" || pathname === "/register") {
          return true;
        }

        // Everything else requires authentication.
        return !!token;
      },
    },
    pages: {
      signIn: "/login",
    },
  }
);

export const config = {
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};