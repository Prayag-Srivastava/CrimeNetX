/**
 * JWT auth middleware — verifies access token and attaches req.user.
 */
import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { ApiError } from "./errorHandler";
import { logger } from "../utils/logger";
import { Role } from "../types/roles";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  department: string;
  badgeNumber: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export interface TokenPayload {
  sub: string;
  email: string;
  role: Role;
}

export function signAccessToken(user: AuthUser): string {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role } satisfies TokenPayload,
    env.jwtSecret,
    { expiresIn: env.jwtExpiry as jwt.SignOptions["expiresIn"] }
  );
}

export function signRefreshToken(userId: string): string {
  // jti (random id) makes every issued token unique — JWTs with identical
  // claims+expiry are otherwise byte-identical, which would collide on the
  // RefreshToken.token unique index.
  return jwt.sign({ sub: userId, jti: crypto.randomUUID() }, env.jwtRefreshSecret, {
    expiresIn: env.jwtRefreshExpiry as jwt.SignOptions["expiresIn"],
  });
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new ApiError(401, "Authentication required");
    }
    const token = header.slice(7);
    const payload = jwt.verify(token, env.jwtSecret) as TokenPayload;
    if (!payload.sub) throw new ApiError(401, "Invalid token");

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true, role: true, department: true, badgeNumber: true },
    });
    if (!user) throw new ApiError(401, "User no longer exists");

    req.user = user;
    next();
  } catch (err) {
    if (err instanceof ApiError) {
      next(err);
    } else if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.TokenExpiredError) {
      next(new ApiError(401, "Invalid or expired token"));
    } else {
      logger.error("auth middleware error", err as Error);
      next(new ApiError(401, "Authentication failed"));
    }
  }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    try {
      const payload = jwt.verify(header.slice(7), env.jwtSecret) as TokenPayload;
      if (payload.sub) {
        prisma.user
          .findUnique({
            where: { id: payload.sub },
            select: { id: true, email: true, name: true, role: true, department: true, badgeNumber: true },
          })
          .then((u) => {
            if (u) req.user = u;
            next();
          })
          .catch(() => next());
        return;
      }
    } catch {
      /* fall through */
    }
  }
  next();
}
