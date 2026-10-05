import path from 'path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  // Monorepo: la raíz del file-tracing es la raíz del repo, para que los
  // workspaces @gestor/* se resuelvan bien y no se arrastre de más.
  outputFileTracingRoot: path.join(process.cwd(), '..', '..'),
  // pdf-parse/pdfjs-dist requieren su worker y módulos nativos resueltos desde
  // node_modules en runtime (no se pueden empaquetar en chunks de Next).
  serverExternalPackages: ['pdf-parse', 'pdfjs-dist', '@napi-rs/canvas'],
};

export default nextConfig;
