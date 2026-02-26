/**
 * File operations executor — handles read, write, edit with path security
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import type { ReadPayload, WritePayload, EditPayload } from '../protocol.js';

const MAX_FILE_SIZE = 50 * 1024; // 50KB
const MAX_LINES = 2000;

export interface FileOperationResult {
  success: boolean;
  content?: string;
  error?: string;
  linesRead?: number;
  truncated?: boolean;
}

export class FileExecutor {
  constructor(private rootPath: string) {}

  /**
   * Validate and resolve a path relative to root
   * Prevents directory traversal attacks
   */
  private validatePath(inputPath: string): string | null {
    try {
      const resolvedPath = resolve(this.rootPath, inputPath);
      const relativePath = relative(this.rootPath, resolvedPath);
      
      // Check if the resolved path is within the root directory
      if (relativePath.startsWith('..') || relativePath === '..') {
        return null; // Path escapes root directory
      }
      
      return resolvedPath;
    } catch (err) {
      return null;
    }
  }

  /**
   * Read file with offset/limit support and truncation
   */
  read(payload: ReadPayload): FileOperationResult {
    const validPath = this.validatePath(payload.path);
    if (!validPath) {
      return { success: false, error: 'Invalid path: cannot access outside root directory' };
    }

    try {
      if (!existsSync(validPath)) {
        return { success: false, error: 'File not found' };
      }

      const content = readFileSync(validPath, 'utf8');
      const lines = content.split('\n');
      
      let result: string;
      let linesRead: number;
      let truncated = false;

      // Apply offset and limit
      const startLine = (payload.offset ?? 1) - 1; // Convert to 0-based
      const maxLines = Math.min(payload.limit ?? MAX_LINES, MAX_LINES);
      
      if (startLine >= lines.length) {
        return { success: true, content: '', linesRead: 0 };
      }

      const selectedLines = lines.slice(startLine, startLine + maxLines);
      result = selectedLines.join('\n');
      linesRead = selectedLines.length;

      // Check if we hit the line limit
      if (lines.length > startLine + maxLines) {
        truncated = true;
      }

      // Check file size limit
      if (result.length > MAX_FILE_SIZE) {
        result = result.substring(0, MAX_FILE_SIZE);
        truncated = true;
      }

      return {
        success: true,
        content: result,
        linesRead,
        truncated
      };

    } catch (err) {
      return { success: false, error: `Failed to read file: ${(err as Error).message}` };
    }
  }

  /**
   * Write file with auto-creation of parent directories
   */
  write(payload: WritePayload): FileOperationResult {
    const validPath = this.validatePath(payload.path);
    if (!validPath) {
      return { success: false, error: 'Invalid path: cannot access outside root directory' };
    }

    try {
      // Create parent directories if they don't exist
      const parentDir = dirname(validPath);
      if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
      }

      writeFileSync(validPath, payload.content, 'utf8');
      
      return { success: true };

    } catch (err) {
      return { success: false, error: `Failed to write file: ${(err as Error).message}` };
    }
  }

  /**
   * Edit file by finding exact oldText and replacing with newText
   */
  edit(payload: EditPayload): FileOperationResult {
    const validPath = this.validatePath(payload.path);
    if (!validPath) {
      return { success: false, error: 'Invalid path: cannot access outside root directory' };
    }

    try {
      if (!existsSync(validPath)) {
        return { success: false, error: 'File not found' };
      }

      const content = readFileSync(validPath, 'utf8');
      
      // Find exact match
      const oldTextIndex = content.indexOf(payload.oldText);
      if (oldTextIndex === -1) {
        return { success: false, error: 'Old text not found in file' };
      }

      // Replace the text
      const newContent = content.substring(0, oldTextIndex) + 
                        payload.newText + 
                        content.substring(oldTextIndex + payload.oldText.length);

      writeFileSync(validPath, newContent, 'utf8');
      
      return { success: true };

    } catch (err) {
      return { success: false, error: `Failed to edit file: ${(err as Error).message}` };
    }
  }
}

export function createFileExecutor(rootPath: string): FileExecutor {
  return new FileExecutor(rootPath);
}