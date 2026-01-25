import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { transform } from 'esbuild';

export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && url.endsWith('.jsx')) {
    const filename = fileURLToPath(url);
    const source = await readFile(filename, 'utf8');

    const out = await transform(source, {
      loader: 'jsx',
      format: 'esm',
      jsx: 'automatic',
      sourcemap: 'inline',
      sourcefile: filename,
    });

    return {
      format: 'module',
      source: out.code,
      shortCircuit: true,
    };
  }

  return nextLoad(url, context);
}
