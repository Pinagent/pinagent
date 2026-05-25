import { sep } from 'node:path';
import { transformJsx } from './transform';

interface LoaderContext {
  resourcePath: string;
  rootContext: string;
  async(): (err: Error | null, content?: string) => void;
}

/**
 * Webpack loader for Next.js. Runs the same JSX transform as @pinpoint/vite-plugin.
 *
 * Wire it up via @pinpoint/next/config or directly in next.config.js:
 *
 *   webpack(config, { dev, isServer }) {
 *     if (dev && !isServer) {
 *       config.module.rules.unshift({
 *         test: /\.(t|j)sx$/,
 *         exclude: /node_modules/,
 *         use: require.resolve('@pinpoint/next/loader'),
 *       });
 *     }
 *     return config;
 *   }
 */
export default function pinpointLoader(this: LoaderContext, source: string): void {
  const cb = this.async();
  try {
    const resource = this.resourcePath;
    if (!/\.(t|j)sx$/.test(resource)) {
      cb(null, source);
      return;
    }
    if (resource.includes(`${sep}node_modules${sep}`)) {
      cb(null, source);
      return;
    }
    const rel = toPosix(relativeFrom(this.rootContext, resource));
    const ts = /\.tsx$/.test(resource);
    const transformed = transformJsx(source, { relPath: rel, ts });
    cb(null, transformed ?? source);
  } catch (e) {
    cb(e instanceof Error ? e : new Error(String(e)));
  }
}

function relativeFrom(from: string, to: string): string {
  // Webpack provides rootContext (project root). Strip the prefix if present;
  // fall back to the absolute path if outside the root.
  if (to.startsWith(`${from}${sep}`)) return to.slice(from.length + 1);
  if (to.startsWith(`${from}/`)) return to.slice(from.length + 1);
  return to;
}

function toPosix(p: string): string {
  return p.split(sep).join('/');
}
