/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    // Next 16.3.1 rewrites tsconfig.json while its in-build TypeScript worker is
    // running, and that worker dies silently on roughly one clean build in three
    // -- which would fail ~1/3 of Vercel deploys. Type checking still happens, in
    // the `build` script, where `tsc --noEmit` runs first and deterministically.
    ignoreBuildErrors: true,
  },
};
export default nextConfig;
