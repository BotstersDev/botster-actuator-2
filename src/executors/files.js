// @ts-check
/**
 * File operations executor — handles read, write, edit with path security
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';

const MAX_FILE_SIZE = 50 * 1024; // 50KB
const MAX_LINES = 2000;

/**
 * @typedef {{ success: boolean, content?: string, error?: string, linesRead?: number, truncated?: boolean }} FileOperationResult
 */

export class FileExecutor {
  #rootPath;

  /** @param {string} rootPath */
  constructor(rootPath) {
    this.#rootPath = rootPath;
  }

  /**
   * Validate and resolve a path relative to root.
   * Prevents directory traversal attacks.
   * @param {string} inputPath
   * @returns {string | null}
   */
  #validatePath(inputPath) {
    try {
      const resolvedPath = resolve(this.#rootPath, inputPath);
      const relativePath = relative(this.#rootPath, resolvedPath);

      if (relativePath.startsWith('..') || relativePath === '..') {
        return null;
      }

      return resolvedPath;
    } catch (_err) {
      return null;
    }
  }

  /**
   * Read file with offset/limit support and truncation
   * @param {import('../protocol.js').ReadPayload} payload
   * @returns {FileOperationResult}
   */
  read(payload) {
    const validPath = this.#validatePath(payload.path);
    if (!validPath) {
      return { success: false, error: 'Invalid path: cannot access outside root directory' };
    }

    try {
      if (!existsSync(validPath)) {
        return { success: false, error: 'File not found' };
      }

      const content = readFileSync(validPath, 'utf8');
      const lines = content.split('\n');

      const startLine = (payload.offset ?? 1) - 1;
      const maxLines = Math.min(payload.limit ?? MAX_LINES, MAX_LINES);

      if (startLine >= lines.length) {
        return { success: true, content: '', linesRead: 0 };
      }

      const selectedLines = lines.slice(startLine, startLine + maxLines);
      let result = selectedLines.join('\n');
      const linesRead = selectedLines.length;
      let truncated = false;

      if (lines.length > startLine + maxLines) {
        truncated = true;
      }

      if (result.length > MAX_FILE_SIZE) {
        result = result.substring(0, MAX_FILE_SIZE);
        truncated = true;
      }

      return { success: true, content: result, linesRead, truncated };
    } catch (err) {
      return { success: false, error: `Failed to read file: ${/** @type {Error} */ (err).message}` };
    }
  }

  /**
   * Write file with auto-creation of parent directories
   * @param {import('../protocol.js').WritePayload} payload
   * @returns {FileOperationResult}
   */
  write(payload) {
    const validPath = this.#validatePath(payload.path);
    if (!validPath) {
      return { success: false, error: 'Invalid path: cannot access outside root directory' };
    }

    try {
      const parentDir = dirname(validPath);
      if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
      }

      writeFileSync(validPath, payload.content, 'utf8');
      return { success: true };
    } catch (err) {
      return { success: false, error: `Failed to write file: ${/** @type {Error} */ (err).message}` };
    }
  }

  /**
   * Edit file by finding exact oldText and replacing with newText
   * @param {import('../protocol.js').EditPayload} payload
   * @returns {FileOperationResult}
   */
  edit(payload) {
    const validPath = this.#validatePath(payload.path);
    if (!validPath) {
      return { success: false, error: 'Invalid path: cannot access outside root directory' };
    }

    try {
      if (!existsSync(validPath)) {
        return { success: false, error: 'File not found' };
      }

      const content = readFileSync(validPath, 'utf8');

      const oldTextIndex = content.indexOf(payload.oldText);
      if (oldTextIndex === -1) {
        return { success: false, error: 'Old text not found in file' };
      }

      const newContent = content.substring(0, oldTextIndex) +
        payload.newText +
        content.substring(oldTextIndex + payload.oldText.length);

      writeFileSync(validPath, newContent, 'utf8');
      return { success: true };
    } catch (err) {
      return { success: false, error: `Failed to edit file: ${/** @type {Error} */ (err).message}` };
    }
  }
}

/**
 * @param {string} rootPath
 * @returns {FileExecutor}
 */
export function createFileExecutor(rootPath) {
  return new FileExecutor(rootPath);
}
