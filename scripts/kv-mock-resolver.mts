/**
 * Node loader hook：把 @vercel/kv 解析到我们的内存 mock。
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve as pathResolve, dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const mockUrl = pathToFileURL(pathResolve(__dirname, 'kv-mock.mts')).href;

export async function resolve(
  specifier: string,
  context: { parentURL?: string },
  nextResolve: (s: string, c: typeof context) => Promise<{ url: string; format?: string }>
): Promise<{ url: string; format?: string; shortCircuit?: boolean }> {
  if (specifier === '@vercel/kv') {
    return { url: mockUrl, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
