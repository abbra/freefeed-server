import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const interfaceVersion = 2;

/**
 * Custom resolver for ESLint's eslint-plugin-import
 *
 * Why: The default 'eslint-plugin-import' resolver doesn't resolve node_modules
 * imports correctly if they aren't use 'main' field in package.json (see
 * https://github.com/import-js/eslint-plugin-import/issues/2132 issue).
 *
 * This custom resolver fixes the issue by using Node.js's built-in
 * import.meta.resolve which properly handles node_modules imports. For the
 * relative paths it uses the standard URL constructor to resolve them. It also
 * checks for extensions and index.* files in directories.
 *
 * @param {string} source - The import path (e.g., './utils', 'express')
 * @param {string} file - The file path where the import is made
 * @param {{extensions?: string[]}} config - ESLint config with extensions
 * @returns {{found: boolean, path?: string|null}}
 */
export function resolve(source, file, config) {
  try {
    if (source.startsWith('.')) {
      // Relative path, resolve it against the current file
      const resolved = checkExtensions(
        fileURLToPath(new URL(source, pathToFileURL(file)).href),
        config.extensions,
      );
      return { found: true, path: resolved };
    }

    // Node module, built-in or third-party
    const resolved = import.meta.resolve(source);
    return {
      found: true,
      // Node.js built-in modules don't have file paths
      path: resolved.startsWith('node:') ? null : fileURLToPath(resolved),
    };
  } catch {
    // Just ignore the error and return "not found"
  }

  return { found: false };
}

const checkExtensionsCache = new Map();

function checkExtensions(path, extensions = ['.js']) {
  // Check cache first
  if (checkExtensionsCache.has(path)) {
    return checkExtensionsCache.get(path);
  }

  const result = checkExtensionsImpl(path, extensions);
  checkExtensionsCache.set(path, result);
  return result;
}

function checkExtensionsImpl(path, extensions) {
  // Check bare path first
  if (existsSync(path)) {
    const stats = statSync(path);

    if (stats.isDirectory()) {
      // Check index.* files in directory
      for (const ext of extensions) {
        const indexPath = join(path, `index${ext}`);

        if (existsSync(indexPath)) {
          return indexPath;
        }
      }
    } else {
      return path;
    }
  }

  // Check path with extensions
  for (const ext of extensions) {
    const pathWithExt = path + ext;

    if (existsSync(pathWithExt)) {
      return pathWithExt;
    }
  }

  // Nothing found, throw ENOENT
  const error = new Error(`ENOENT: no such file or directory, open '${path}'`);
  error.code = 'ENOENT';
  throw error;
}
