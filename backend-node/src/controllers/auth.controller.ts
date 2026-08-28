/**
 * Auth controller — register, login, refresh, me.
 * JWT access + refresh tokens; refresh tokens stored hashed in DB for revocation.
 */
import { NextFunction, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { ApiError } from "../middleware/errorHandler";
import { signAccessToken, signRefreshToken, AuthUser } from "../middleware/auth";
import { audit } from "../services/audit.service";
import { Role } from "../types/roles";
import { logger } from "../utils/logger";

const VALID_ROLES: Role[] = ["INVESTIGATOR", "DSP", "SP", "DGP"];

export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, name, password, role, department, badgeNumber } = req.body as {
      email?: string;
      name?: string;
      password?: string;
      role?: Role;
      department?: string;
      badgeNumber?: string;
    };

    if (!email || !name || !password) throw new ApiError(400, "email, name and password are required");
    if (password.length < 8) throw new ApiError(400, "Password must be at least 8 characters");

    const normalizedRole = role ?? "INVESTIGATOR";
    if (!VALID_ROLES.includes(normalizedRole)) {
      throw new ApiError(400, `role must be one of: ${VALID_ROLES.join(", ")}`);
    }

    const exists = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (exists) throw new ApiError(409, "A user with this email already exists");

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        name,
        passwordHash,
        role: normalizedRole,
        department: department || "",
        badgeNumber: badgeNumber || "",
      },
      select: { id: true, email: true, name: true, role: true, department: true, badgeNumber: true, createdAt: true },
    });

    await audit(
      { userId: user.id, ipAddress: req.ip },
      "USER_REGISTERED",
      "User",
      user.id,
      { email: user.email, role: user.role }
    );

    const authUser: AuthUser = { ...user };
    const accessToken = signAccessToken(authUser);
    const refreshToken = await issueRefreshToken(user.id);

    res.status(201).json({ user, accessToken, refreshToken });
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) throw new ApiError(400, "email and password are required");

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) throw new ApiError(401, "Invalid credentials");

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new ApiError(401, "Invalid credentials");

    const authUser: AuthUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      department: user.department,
      badgeNumber: user.badgeNumber,
    };
    const accessToken = signAccessToken(authUser);
    const refreshToken = await issueRefreshToken(user.id);

    await audit(
      { userId: user.id, ipAddress: req.ip },
      "USER_LOGIN",
      "User",
      user.id
    );

    res.json({ user: authUser, accessToken, refreshToken });
  } catch (err) {
    next(err);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction) {
  try {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (!refreshToken) throw new ApiError(400, "refreshToken required");

    // Hash the presented token before looking it up (tokens never stored raw).
    const hash = crypto.createHash("sha256").update(refreshToken).digest("hex");
    const record = await prisma.refreshToken.findUnique({ where: { token: hash } });
    if (!record || record.expiresAt < new Date()) {
      throw new ApiError(401, "Invalid or expired refresh token");
    }

    const payload = jwt.verify(refreshToken, env.jwtRefreshSecret) as { sub: string };
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true, role: true, department: true, badgeNumber: true },
    });
    if (!user) throw new ApiError(401, "User no longer exists");

    const authUser: AuthUser = { ...user };
    const accessToken = signAccessToken(authUser);
    const newRefresh = await issueRefreshToken(user.id);

    // Rotate: revoke the used token (detect reuse).
    await prisma.refreshToken.delete({ where: { id: record.id } });

    res.json({ accessToken, refreshToken: newRefresh });
  } catch (err) {
    next(err);
  }
}

export async function me(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new ApiError(401, "Authentication required");
    res.json({ user: req.user });
  } catch (err) {
    next(err);
  }
}

async function issueRefreshToken(userId: string): Promise<string> {
  const token = signRefreshToken(userId);
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const expires = new Date(Date.now() + parseDurationToMs(env.jwtRefreshExpiry));
  await prisma.refreshToken.create({ data: { token: hash, userId, expiresAt: expires } });
  return token;
}

function parseDurationToMs(duration: string): number {
  const match = /^(\d+)([smhd])$/.exec(duration);
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case "s":
      return value * 1000;
    case "m":
      return value * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    case "d":
      return value * 24 * 60 * 60 * 1000;
    default:
      return 7 * 24 * 60 * 60 * 1000;
  }
}
