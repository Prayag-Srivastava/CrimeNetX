/**
 * CrimeNetX Node backend — environment configuration.
 * All secrets come from env vars; fail-fast in production if missing.
 */
import dotenv from "dotenv";

dotenv.config();

const requireEnv = (name: string, fallback?: string): string => {
  const value = process.env[name];
  if (value === undefined || value === "") {
    if (fallback !== undefined) return fallback;
    if (process.env.NODE_ENV === "production") {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return fallback ?? "";
  }
  return value;
};

export const env = {
  port: parseInt(process.env.PORT || "5000", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  isProd: process.env.NODE_ENV === "production",

  databaseUrl: requireEnv("DATABASE_URL", "postgresql://crimenetx:crimenetx@localhost:5432/crimenetx?schema=public"),
  redisUrl: requireEnv("REDIS_URL", "redis://localhost:6379"),

  jwtSecret: requireEnv("JWT_SECRET", "dev_jwt_secret_change_me"),
  jwtRefreshSecret: requireEnv("JWT_REFRESH_SECRET", "dev_refresh_secret_change_me"),
  jwtExpiry: requireEnv("JWT_EXPIRY", "15m"),
  jwtRefreshExpiry: process.env.JWT_REFRESH_EXPIRY || "7d",

  aws: {
    accessKeyId: requireEnv("AWS_ACCESS_KEY_ID", ""),
    secretAccessKey: requireEnv("AWS_SECRET_ACCESS_KEY", ""),
    region: requireEnv("AWS_REGION", "ap-south-1"),
    bucket: requireEnv("AWS_S3_BUCKET", "crimenetx-evidence"),
  },

  aiServiceUrl: requireEnv("AI_SERVICE_URL", "http://localhost:8000"),
  frontendUrl: requireEnv("FRONTEND_URL", "http://localhost:3000"),
} as const;
