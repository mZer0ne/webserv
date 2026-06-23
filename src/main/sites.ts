import Store from 'electron-store';
import { app } from 'electron';
import { join, relative, posix } from 'path';
import { existsSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'fs';
import {
  getDocker,
  ensureNetwork,
  connectToNetwork,
} from './docker.js';
import { composeUpService, isWebServComposeContainer } from './compose.js';
import { getSettings } from './settings.js';
import { syncHosts } from './hosts.js';

export interface Site {
  id: string;
  domain: string;
  root: string;        // absolute host path (must live under sitesRoot)
  php: string | null;  // PHP version like "8.3", or null for static
  createdAt: string;
}

interface SitesStore {
  sites: Site[];
}

const store = new Store<SitesStore>({ name: 'webserv-sites', defaults: { sites: [] } });

const CONTAINER_MOUNT = '/var/www';

function confDir(): string {
  const dir = join(app.getPath('userData'), 'web', 'conf.d');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function phpContainerName(version: string): string {
  return `webserv-rt-php-${version}`;
}

/** Map an absolute host path under sitesRoot to its path inside the shared containers. */
function containerRoot(hostPath: string): string | null {
  const { sitesRoot } = getSettings();
  const rel = relative(sitesRoot, hostPath);
  if (rel.startsWith('..') || posix.isAbsolute(rel.split('\\').join('/'))) return null;
  return posix.join(CONTAINER_MOUNT, rel.split('\\').join('/'));
}

function vhostConf(site: Site): string {
  const root = containerRoot(site.root);
  const { httpPort } = getSettings().web;
  const phpBlock = site.php
    ? `
    location ~ \\.php$ {
        fastcgi_pass ${phpContainerName(site.php)}:9000;
        fastcgi_index index.php;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        fastcgi_param SERVER_PORT ${httpPort};
    }`
    : '';
  return `# Managed by WebServ — ${site.domain}
server {
    listen 80;
    server_name ${site.domain};
    root ${root};
    index index.php index.html index.htm;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }
${phpBlock}
}
`;
}

// ---------------------------------------------------------------------------
// Shared nginx web server
// ---------------------------------------------------------------------------

async function findContainer(name: string) {
  const containers = await getDocker().listContainers({ all: true });
  return containers.find((c) => (c.Names || []).some((n) => n.replace(/^\//, '') === name));
}

async function removeContainer(id: string, running?: boolean): Promise<void> {
  const container = getDocker().getContainer(id);
  if (running) await container.stop().catch(() => {});
  await container.remove({ force: true });
}

export async function ensureWeb(): Promise<void> {
  const docker = getDocker();
  const { web, networkName, sitesRoot } = getSettings();
  await ensureNetwork(networkName);
  mkdirSync(sitesRoot, { recursive: true });
  const dir = confDir();

  let found = await findContainer(web.containerName);
  if (found) {
    // Recreate if the published http port no longer matches settings.
    try {
      const info = await docker.getContainer(found.Id).inspect();
      const hp = info.HostConfig?.PortBindings?.['80/tcp']?.[0]?.HostPort;
      if (hp !== String(web.httpPort) || !isWebServComposeContainer(found)) {
        await removeContainer(found.Id, info.State?.Running);
        found = undefined;
      }
    } catch {
      /* fall through */
    }
  }

  if (!found) {
    await composeUpService('web', {
      container_name: web.containerName,
      image: web.image,
      labels: { 'com.webserv.managed': 'true', 'com.webserv.role': 'web' },
      ports: [`${web.httpPort}:80`],
      volumes: [`${sitesRoot}:${CONTAINER_MOUNT}:ro`, `${dir}:/etc/nginx/conf.d:ro`],
      restart: 'unless-stopped',
      networks: [networkName],
    }, networkName);
    found = await findContainer(web.containerName);
  } else if (found.State !== 'running') {
    await docker.getContainer(found.Id).start();
  }
  if (found) await connectToNetwork(networkName, found.Id);
}

async function reloadWeb(): Promise<void> {
  const { web } = getSettings();
  const found = await findContainer(web.containerName);
  if (!found || found.State !== 'running') return;
  try {
    const exec = await getDocker().getContainer(found.Id).exec({
      Cmd: ['nginx', '-s', 'reload'],
      AttachStdout: true,
      AttachStderr: true,
    });
    await exec.start({});
  } catch {
    await getDocker().getContainer(found.Id).restart().catch(() => {});
  }
}

/** Ensure the PHP-FPM runtime for a version exists and mounts the sites root. */
async function ensurePhp(version: string): Promise<void> {
  const docker = getDocker();
  const { networkName, sitesRoot } = getSettings();
  const name = phpContainerName(version);
  const found = await findContainer(name);

  if (found) {
    // Verify it mounts the sites root; recreate if not.
    const info = await docker.getContainer(found.Id).inspect();
    const hasMount = (info.Mounts || []).some((m) => m.Destination === CONTAINER_MOUNT);
    if (hasMount && isWebServComposeContainer(found)) {
      if (found.State !== 'running') await docker.getContainer(found.Id).start();
      return;
    }
    await removeContainer(found.Id, info.State?.Running);
  }

  const image = `php:${version}-fpm`;
  await composeUpService(`php-${version.replace(/[^a-zA-Z0-9_-]/g, '-')}`, {
    container_name: name,
    image,
    labels: {
      'com.webserv.managed': 'true',
      'com.webserv.runtime': `php-${version}`,
      'com.webserv.category': 'PHP',
    },
    restart: 'unless-stopped',
    volumes: [`${sitesRoot}:${CONTAINER_MOUNT}`],
    networks: [networkName],
  }, networkName);
}

// ---------------------------------------------------------------------------
// Site CRUD
// ---------------------------------------------------------------------------

export function listSites(): Site[] {
  return store.get('sites');
}

async function applyHosts(): Promise<void> {
  const domains = new Set(listSites().map((s) => s.domain.split(':')[0]));
  await syncHosts(domains);
}

function writeAllConfs(): void {
  const dir = confDir();
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.conf')) rmSync(join(dir, f), { force: true });
  }
  for (const site of listSites()) {
    writeFileSync(join(dir, `${site.domain}.conf`), vhostConf(site), 'utf8');
  }
}

export interface AddSiteInput {
  domain: string;
  root: string;
  php: string | null;
}

export async function addSite(
  input: AddSiteInput
): Promise<{ success: boolean; site?: Site; error?: string }> {
  const domain = input.domain.trim().replace(/^https?:\/\//, '').split('/')[0];
  if (!domain) return { success: false, error: 'Invalid domain' };
  if (!existsSync(input.root)) return { success: false, error: 'Folder does not exist' };
  if (!containerRoot(input.root)) {
    return { success: false, error: `Folder must live under sites root (${getSettings().sitesRoot})` };
  }
  if (listSites().some((s) => s.domain === domain)) {
    return { success: false, error: `Site ${domain} already exists` };
  }

  const site: Site = {
    id: domain,
    domain,
    root: input.root,
    php: input.php,
    createdAt: new Date().toISOString(),
  };

  try {
    await ensureWeb();
    if (site.php) await ensurePhp(site.php);
    store.set('sites', [...listSites(), site]);
    writeAllConfs();
    await reloadWeb();
    await applyHosts();
    return { success: true, site };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function removeSite(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    store.set('sites', listSites().filter((s) => s.id !== id));
    writeAllConfs();
    await reloadWeb();
    await applyHosts();
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export interface WebStatus {
  installed: boolean;
  running: boolean;
  httpPort: number;
  sitesRoot: string;
}

export async function getWebStatus(): Promise<WebStatus> {
  const { web, sitesRoot } = getSettings();
  const found = await findContainer(web.containerName);
  return {
    installed: !!found,
    running: found?.State === 'running',
    httpPort: web.httpPort,
    sitesRoot,
  };
}
