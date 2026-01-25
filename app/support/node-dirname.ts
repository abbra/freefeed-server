import { fileURLToPath } from 'url';
import { dirname } from 'path';

export function nodeDirname(importMetaUrl: string): string {
  return dirname(fileURLToPath(importMetaUrl));
}
