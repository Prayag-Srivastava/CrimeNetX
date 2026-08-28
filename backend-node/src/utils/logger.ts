/**
 * Structured logger (winston) with JSON output in production.
 */
import winston from "winston";

const format = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
    return `${timestamp} ${level.toUpperCase()} ${message}${metaStr}${stack ? `\n${stack}` : ""}`;
  })
);

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format,
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "logs/error.log", level: "error" }),
    new winston.transports.File({ filename: "logs/combined.log" }),
  ],
});
