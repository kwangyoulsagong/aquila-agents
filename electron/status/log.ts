// Raw OSC 7501 reports and hook events, for debugging status. ~/.aquila/status.log, rotated at 512 KB (one backup).
import fs from 'node:fs';
import path from 'node:path';
import { APP_DIR } from '../config';

const LOG_PATH = path.join(APP_DIR, 'status.log');
const MAX_BYTES = 512 * 1024;

let size = -1;

export function logStatus(tabId: string, source: string, raw: string): void {
  try {
    if (size < 0) size = fs.existsSync(LOG_PATH) ? fs.statSync(LOG_PATH).size : 0;
    if (size > MAX_BYTES) {
      fs.renameSync(LOG_PATH, `${LOG_PATH}.1`);
      size = 0;
    }
    // Control characters escaped so the log stays one line per entry.
    const safe = raw
      .slice(0, 600)
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
    const line = `${new Date().toISOString()} ${tabId} ${source} ${safe}\n`;
    fs.mkdirSync(APP_DIR, { recursive: true });
    fs.appendFileSync(LOG_PATH, line);
    size += Buffer.byteLength(line);
  } catch {
    // debugging aid only
  }
}
