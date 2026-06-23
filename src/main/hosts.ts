import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const START_MARKER = '# === WebServ Domains Start ===';
const END_MARKER = '# === WebServ Domains End ===';
const HOSTS_PATH = '/etc/hosts';

/** Rewrite the WebServ-managed block of /etc/hosts to contain exactly `domains`. */
export async function syncHosts(domains: Set<string>): Promise<void> {
  if (!existsSync(HOSTS_PATH)) return;

  let currentHosts: string;
  try {
    currentHosts = readFileSync(HOSTS_PATH, 'utf8');
  } catch (e) {
    console.error('Failed to read /etc/hosts:', e);
    return;
  }

  const lines = currentHosts.split(/\r?\n/);
  const cleanLines: string[] = [];
  let inBlock = false;
  for (const line of lines) {
    const t = line.trim();
    if (t === START_MARKER) { inBlock = true; continue; }
    if (t === END_MARKER) { inBlock = false; continue; }
    if (!inBlock) cleanLines.push(line);
  }

  const newBlock: string[] = [];
  if (domains.size > 0) {
    newBlock.push(START_MARKER);
    for (const d of domains) newBlock.push(`127.0.0.1 ${d}`);
    newBlock.push(END_MARKER);
  }

  let newContent = cleanLines.join('\n').trim();
  newContent += newBlock.length > 0 ? '\n\n' + newBlock.join('\n') + '\n' : '\n';

  if (currentHosts.replace(/\r?\n/g, '\n').trim() === newContent.replace(/\r?\n/g, '\n').trim()) {
    return;
  }

  const tempPath = join(app.getPath('userData'), 'hosts.tmp');
  writeFileSync(tempPath, newContent, 'utf8');
  const cmd = `osascript -e 'do shell script "cp \\"${tempPath}\\" ${HOSTS_PATH}" with administrator privileges'`;
  await execAsync(cmd);
  console.log('Updated /etc/hosts with', domains.size, 'domains');
}
