import path from 'path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Monorepo: la raíz del file-tracing es la raíz del repo, para que los
  // workspaces @gestor/* se resuelvan bien y no se arrastre de más.
  outputFileTracingRoot: path.join(process.cwd(), '..', '..'),
};

export default nextConfig;
