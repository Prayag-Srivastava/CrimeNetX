/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone", // required for the Dockerfile runner stage
  reactStrictMode: true,
  // NextAuth crashes at build if NEXTAUTH_URL is empty — provide a sane default
  // so the project builds even before the user fills .env.local.
  env: {
    NEXTAUTH_URL: process.env.NEXTAUTH_URL || "http://localhost:3000",
  },
  transpilePackages: ["@xyflow/react", "leaflet", "react-leaflet"],
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
  // Docker: trust the proxy headers so NextAuth works behind compose.
  poweredByHeader: false,
};

module.exports = nextConfig;
