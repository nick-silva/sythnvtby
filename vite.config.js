import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

/** Set `VITE_DEV_HTTPS=1` (see `npm run dev:https`) so LAN access uses https:// — fewer Chrome “download not secure” warnings than plain http:// + IP. */
const devHttps =
  process.env.VITE_DEV_HTTPS === '1' || process.env.VITE_DEV_HTTPS === 'true';

/** Comma-separated hostnames/IPs for the dev cert SAN (e.g. `192.168.5.253,localhost`). Needed so Chrome trusts the cert when you open the site by LAN IP. */
const devSslDomains = process.env.VITE_DEV_SSL_DOMAINS
  ? process.env.VITE_DEV_SSL_DOMAINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  : null;

export default defineConfig({
  root: '.',
  publicDir: 'public',
  plugins: devHttps
    ? [basicSsl(devSslDomains?.length ? { domains: devSslDomains } : {})]
    : [],
  server: {
    // Allow access from other machines on your LAN (e.g. phone/another PC).
    host: true, // equivalent to 0.0.0.0
    // Local hostname served by the Caddy reverse proxy (http://sythnvtby; *.localhost is allowed already).
    allowedHosts: ['sythnvtby'],
    // port: 5173,
    // strictPort: true,
  },
  test: {
    include: ['src/**/*.test.js'],
    exclude: ['**/node_modules/**', '**/.emsdk/**', '**/core-build/**'],
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: [
        'index.html',
        // The sythnvtby Player: plays a game with its play pack, no authoring tools.
        'player.html',
        'tools/index.html',
        'tools/editor.html',
        'tools/viewer.html',
        'tools/memory-analysis.html',
        'tools/project.html',
        // Redirect stub: the Project tool used to live at painter.html.
        'tools/painter.html',
        'tools/sprite-studio.html',
      ],
    },
  },
});
