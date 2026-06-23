import axios, { AxiosInstance } from 'axios';
import { app } from 'electron';
import { join } from 'path';
import { mkdirSync } from 'fs';
import {
  getDocker,
  ensureNetwork,
  connectToNetwork,
} from './docker.js';
import { composeUpService, isWebServComposeContainer } from './compose.js';
import { getSettings, updateNpm } from './settings.js';

export interface ProxyHost {
  id: number;
  domain_names: string[];
  forward_scheme: string;
  forward_host: string;
  forward_port: number;
  enabled: boolean;
  ssl_forced: boolean;
  certificate_id: number;
}

export interface ProxyStatus {
  ready: boolean;
  installed: boolean;
  running: boolean;
  containerId?: string;
  adminUrl?: string;
  error?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function apiBase(): string {
  const { adminPort } = getSettings().npm;
  return `http://127.0.0.1:${adminPort}/api`;
}

/** Locate the NPM container (by configured name) regardless of running state. */
async function findNpmContainer() {
  const docker = getDocker();
  const { containerName } = getSettings().npm;
  const containers = await docker.listContainers({ all: true });
  return containers.find((c) =>
    (c.Names || []).some((n) => n.replace(/^\//, '') === containerName)
  );
}

export async function getProxyStatus(): Promise<ProxyStatus> {
  try {
    const { adminPort } = getSettings().npm;
    const found = await findNpmContainer();
    if (!found) {
      return { ready: false, installed: false, running: false };
    }
    const running = found.State === 'running';
    let ready = false;
    if (running) {
      try {
        await axios.get(`${apiBase()}/`, { timeout: 2000 });
        ready = true;
      } catch {
        ready = false;
      }
    }
    return {
      ready,
      installed: true,
      running,
      containerId: found.Id,
      adminUrl: `http://127.0.0.1:${adminPort}`,
    };
  } catch (err: any) {
    return { ready: false, installed: false, running: false, error: err.message };
  }
}

/** Create (if missing) and start the NPM container, attached to the app network. */
export async function bootstrapNpm(): Promise<ProxyStatus> {
  const docker = getDocker();
  const settings = getSettings();
  const { npm, networkName } = settings;

  await ensureNetwork(networkName);

  let found = await findNpmContainer();

  // If an existing container has stale host-port bindings (e.g. ports were
  // changed in settings to dodge a conflict), remove it so it is recreated.
  if (found) {
    try {
      const info = await docker.getContainer(found.Id).inspect();
      const pb = info.HostConfig?.PortBindings || {};
      const hp = (k: string) => pb[k]?.[0]?.HostPort;
      const mismatch =
        hp('80/tcp') !== String(npm.httpPort) ||
        hp('443/tcp') !== String(npm.httpsPort) ||
        hp('81/tcp') !== String(npm.adminPort) ||
        !isWebServComposeContainer(found);
      if (mismatch) {
        if (info.State?.Running) await docker.getContainer(found.Id).stop().catch(() => {});
        await docker.getContainer(found.Id).remove({ force: true });
        found = undefined;
      }
    } catch {
      /* inspect failed — fall through and try to start/recreate */
    }
  }

  if (!found) {
    const dataDir = join(app.getPath('userData'), 'npm', 'data');
    const letsencryptDir = join(app.getPath('userData'), 'npm', 'letsencrypt');
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(letsencryptDir, { recursive: true });

    await composeUpService('npm', {
      container_name: npm.containerName,
      image: npm.image,
      labels: { 'com.webserv.managed': 'true' },
      ports: [`${npm.httpPort}:80`, `${npm.httpsPort}:443`, `${npm.adminPort}:81`],
      volumes: [`${dataDir}:/data`, `${letsencryptDir}:/etc/letsencrypt`],
      restart: 'unless-stopped',
      networks: [networkName],
    }, networkName);
    found = await findNpmContainer();
  } else if (found.State !== 'running') {
    await docker.getContainer(found.Id).start();
  }

  if (found) {
    await connectToNetwork(networkName, found.Id);
  }

  // Wait for the API to come up (first boot runs migrations — can take a while).
  for (let i = 0; i < 60; i++) {
    try {
      await axios.get(`${apiBase()}/`, { timeout: 2000 });
      break;
    } catch {
      await sleep(2000);
    }
  }

  return getProxyStatus();
}

/** Obtain a valid bearer token, logging in if needed. Caches in settings. */
async function getClient(): Promise<AxiosInstance> {
  const npm = getSettings().npm;
  const now = Date.now();
  const cachedValid =
    npm.token && npm.tokenExpires && new Date(npm.tokenExpires).getTime() - 60_000 > now;

  let token = npm.token;
  if (!cachedValid) {
    const res = await axios.post(`${apiBase()}/tokens`, {
      identity: npm.adminEmail,
      secret: npm.adminPassword,
    });
    token = res.data.token;
    updateNpm({ token, tokenExpires: res.data.expires });
  }

  return axios.create({
    baseURL: apiBase(),
    headers: { Authorization: `Bearer ${token}` },
    timeout: 10_000,
  });
}

export async function listProxyHosts(): Promise<ProxyHost[]> {
  const client = await getClient();
  const res = await client.get('/nginx/proxy-hosts');
  return res.data;
}

export interface UpsertProxyHostInput {
  domain: string;
  forwardHost: string;
  forwardPort: number;
  forwardScheme?: string;
  websocket?: boolean;
}

export async function upsertProxyHost(input: UpsertProxyHostInput): Promise<ProxyHost> {
  const client = await getClient();
  const existing = (await listProxyHosts()).find((h) =>
    h.domain_names.includes(input.domain)
  );

  const body = {
    domain_names: [input.domain],
    forward_scheme: input.forwardScheme || 'http',
    forward_host: input.forwardHost,
    forward_port: input.forwardPort,
    access_list_id: 0,
    certificate_id: 0,
    ssl_forced: false,
    hsts_enabled: false,
    hsts_subdomains: false,
    http2_support: false,
    block_exploits: true,
    caching_enabled: false,
    allow_websocket_upgrade: input.websocket !== false,
    advanced_config: '',
    meta: { letsencrypt_agree: false, dns_challenge: false },
    locations: [],
  };

  if (existing) {
    const res = await client.put(`/nginx/proxy-hosts/${existing.id}`, body);
    if (!existing.enabled) {
      await client.post(`/nginx/proxy-hosts/${existing.id}/enable`);
    }
    return res.data;
  }
  const res = await client.post('/nginx/proxy-hosts', body);
  return res.data;
}

export async function setProxyHostEnabled(id: number, enabled: boolean): Promise<void> {
  const client = await getClient();
  await client.post(`/nginx/proxy-hosts/${id}/${enabled ? 'enable' : 'disable'}`);
}

export async function deleteProxyHost(id: number): Promise<void> {
  const client = await getClient();
  await client.delete(`/nginx/proxy-hosts/${id}`);
}

/** Disable any proxy host that points at the given domain (used on project stop). */
export async function disableProxyForDomain(domain: string): Promise<void> {
  try {
    const host = (await listProxyHosts()).find((h) => h.domain_names.includes(domain));
    if (host && host.enabled) {
      await setProxyHostEnabled(host.id, false);
    }
  } catch {
    // proxy not ready — non-fatal
  }
}
