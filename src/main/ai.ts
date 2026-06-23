import axios from 'axios';
import { app } from 'electron';
import { join } from 'path';
import { mkdirSync } from 'fs';
import {
  getDocker,
  ensureNetwork,
  connectToNetwork,
  imageExists,
  pullImage,
} from './docker.js';
import { getSettings } from './settings.js';

export interface AiStatus {
  installed: boolean;
  running: boolean;
  ready: boolean;
  port: number;
  url?: string;
  error?: string;
}

export interface AiModel {
  name: string;
  size: number;
  parameterSize?: string;
  quantization?: string;
  modified?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function apiBase(): string {
  return `http://127.0.0.1:${getSettings().ai.port}`;
}

async function findContainer() {
  const docker = getDocker();
  const name = getSettings().ai.containerName;
  const containers = await docker.listContainers({ all: true });
  return containers.find((c) => (c.Names || []).some((n) => n.replace(/^\//, '') === name));
}

export async function getAiStatus(): Promise<AiStatus> {
  const { ai } = getSettings();
  try {
    const found = await findContainer();
    if (!found) return { installed: false, running: false, ready: false, port: ai.port };
    const running = found.State === 'running';
    let ready = false;
    if (running) {
      try {
        await axios.get(`${apiBase()}/api/version`, { timeout: 2000 });
        ready = true;
      } catch {
        ready = false;
      }
    }
    return { installed: true, running, ready, port: ai.port, url: apiBase() };
  } catch (err: any) {
    return { installed: false, running: false, ready: false, port: ai.port, error: err.message };
  }
}

export async function bootstrapAi(): Promise<AiStatus> {
  const docker = getDocker();
  const { ai, networkName } = getSettings();
  await ensureNetwork(networkName);

  let found = await findContainer();

  // Recreate if the published port drifted from settings.
  if (found) {
    try {
      const info = await docker.getContainer(found.Id).inspect();
      const hp = info.HostConfig?.PortBindings?.['11434/tcp']?.[0]?.HostPort;
      if (hp !== String(ai.port)) {
        if (info.State?.Running) await docker.getContainer(found.Id).stop().catch(() => {});
        await docker.getContainer(found.Id).remove({ force: true });
        found = undefined;
      }
    } catch {
      /* fall through */
    }
  }

  if (!found) {
    if (!(await imageExists(ai.image))) await pullImage(ai.image);
    const dataDir = join(app.getPath('userData'), 'ollama');
    mkdirSync(dataDir, { recursive: true });
    const container = await docker.createContainer({
      name: ai.containerName,
      Image: ai.image,
      Labels: { 'com.webserv.managed': 'true', 'com.webserv.role': 'ai' },
      ExposedPorts: { '11434/tcp': {} },
      HostConfig: {
        RestartPolicy: { Name: 'unless-stopped' },
        PortBindings: { '11434/tcp': [{ HostPort: String(ai.port) }] },
        Binds: [`${dataDir}:/root/.ollama`],
        NetworkMode: networkName,
      },
    });
    await container.start();
    found = await findContainer();
  } else if (found.State !== 'running') {
    await docker.getContainer(found.Id).start();
  }
  if (found) await connectToNetwork(networkName, found.Id);

  for (let i = 0; i < 30; i++) {
    try {
      await axios.get(`${apiBase()}/api/version`, { timeout: 2000 });
      break;
    } catch {
      await sleep(1500);
    }
  }
  return getAiStatus();
}

export async function listModels(): Promise<AiModel[]> {
  const res = await axios.get(`${apiBase()}/api/tags`, { timeout: 5000 });
  return (res.data.models || []).map((m: any) => ({
    name: m.name,
    size: m.size,
    parameterSize: m.details?.parameter_size,
    quantization: m.details?.quantization_level,
    modified: m.modified_at,
  }));
}

export async function pullModel(name: string): Promise<{ success: boolean; error?: string }> {
  try {
    // stream:false makes Ollama return once the pull is complete.
    await axios.post(
      `${apiBase()}/api/pull`,
      { name, stream: false },
      { timeout: 0 }
    );
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.response?.data?.error || err.message };
  }
}

export async function deleteModel(name: string): Promise<{ success: boolean; error?: string }> {
  try {
    await axios.delete(`${apiBase()}/api/delete`, { data: { name }, timeout: 10000 });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.response?.data?.error || err.message };
  }
}

export async function generate(
  model: string,
  prompt: string
): Promise<{ response?: string; error?: string }> {
  try {
    const res = await axios.post(
      `${apiBase()}/api/generate`,
      { model, prompt, stream: false },
      { timeout: 0 }
    );
    return { response: res.data.response };
  } catch (err: any) {
    return { error: err.response?.data?.error || err.message };
  }
}
