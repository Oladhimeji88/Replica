/**
 * Filesystem locations, resolved relative to this file rather than to the
 * process working directory — so `npm start` works from anywhere, and so does
 * the Docker image.
 *
 * Note there is no `__dirname` in ES modules; the directory has to be derived
 * from `import.meta.url`.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Both `src/config` (dev, via tsx) and `dist/config` (built) sit two levels
 * below the project root, so one expression covers both.
 */
export const PROJECT_ROOT = path.resolve(here, "..", "..");
export const PUBLIC_DIR = path.join(PROJECT_ROOT, "public");
export const GENERATED_DIR = path.join(PUBLIC_DIR, "generated");

export function resolveFromRoot(target: string): string {
  return path.isAbsolute(target) ? target : path.join(PROJECT_ROOT, target);
}
