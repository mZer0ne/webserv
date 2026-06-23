import type { ContainerInfo } from 'dockerode';
import { getDocker } from './docker.js';
import { syncHosts } from './hosts.js';

export interface ProjectContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: ContainerInfo['Ports'];
}

export interface Project {
  id: string;
  name: string;
  stack: string;
  domain: string;
  status: 'running' | 'stopped' | 'starting';
  services: string[];
  containers: ProjectContainer[];
}

function cleanName(c: ContainerInfo): string {
  return c.Names?.[0]?.replace(/^\//, '') || c.Id.substring(0, 12);
}

const PROJECT_TLD = '.test';

export async function getProjectsList(): Promise<Project[]> {
  const docker = getDocker();
  const containers = await docker.listContainers({ all: true });
  const projectsMap = new Map<string, Project>();
  const standalone: ContainerInfo[] = [];

  for (const c of containers) {
    const labels = c.Labels || {};
    const composeProject = labels['com.docker.compose.project'];
    if (!composeProject) {
      standalone.push(c);
      continue;
    }
    if (!projectsMap.has(composeProject)) {
      projectsMap.set(composeProject, {
        id: composeProject,
        name: composeProject,
        stack: 'Docker Compose',
        domain: `${composeProject}${PROJECT_TLD}`,
        status: 'stopped',
        services: [],
        containers: [],
      });
    }
    const project = projectsMap.get(composeProject)!;
    const service = labels['com.docker.compose.service'] || 'unknown';
    if (!project.services.includes(service)) project.services.push(service);
    project.containers.push({
      id: c.Id,
      name: cleanName(c),
      image: c.Image,
      state: c.State,
      status: c.Status,
      ports: c.Ports || [],
    });
    if (c.State === 'running') project.status = 'running';
  }

  const list = Array.from(projectsMap.values());
  for (const project of list) {
    project.stack = detectStack(project);
    project.domain = `${project.name}${PROJECT_TLD}`;
  }

  if (standalone.length > 0) {
    list.push({
      id: 'standalone-containers',
      name: 'Standalone Containers',
      stack: 'Docker Engine',
      domain: 'localhost',
      status: standalone.some((c) => c.State === 'running') ? 'running' : 'stopped',
      services: standalone.map(cleanName),
      containers: standalone.map((c) => ({
        id: c.Id,
        name: cleanName(c),
        image: c.Image,
        state: c.State,
        status: c.Status,
        ports: c.Ports || [],
      })),
    });
  }

  return list;
}

function detectStack(project: Project): string {
  let php = false, laravel = false, wordpress = false, node = false;
  for (const c of project.containers) {
    const s = `${c.image} ${c.name}`.toLowerCase();
    if (/laravel|sail/.test(s)) laravel = true;
    if (/php/.test(s)) php = true;
    if (/wordpress/.test(s)) wordpress = true;
    if (/node|next/.test(s)) node = true;
  }
  if (laravel) return 'Laravel';
  if (wordpress) return 'WordPress';
  if (php) return 'PHP Environment';
  if (node) return 'Node.js Stack';
  if (project.services.includes('nginx')) return 'Nginx Web Server';
  return 'Docker Compose';
}

function targetContainerIds(containers: ContainerInfo[], id: string): ContainerInfo[] {
  return containers.filter((c) =>
    id === 'standalone-containers'
      ? !c.Labels['com.docker.compose.project']
      : c.Labels['com.docker.compose.project'] === id
  );
}

/** Recompute running domains and push them to /etc/hosts. */
async function refreshHosts(projects: Project[]): Promise<void> {
  const domains = new Set<string>();
  for (const p of projects) {
    if (p.status === 'running' && p.domain) {
      const d = p.domain.split(':')[0];
      if (d && d !== 'localhost') domains.add(d);
    }
  }
  await syncHosts(domains);
}

export async function startProject(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const docker = getDocker();
    const containers = await docker.listContainers({ all: true });
    for (const c of targetContainerIds(containers, id)) {
      if (c.State !== 'running') await docker.getContainer(c.Id).start();
    }
    await refreshHosts(await getProjectsList());
    return { success: true };
  } catch (err: any) {
    console.error(`Failed to start project ${id}:`, err);
    return { success: false, error: err.message };
  }
}

export async function stopProject(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const docker = getDocker();
    const containers = await docker.listContainers({ all: true });
    for (const c of targetContainerIds(containers, id)) {
      if (c.State === 'running') await docker.getContainer(c.Id).stop();
    }
    await refreshHosts(await getProjectsList());
    return { success: true };
  } catch (err: any) {
    console.error(`Failed to stop project ${id}:`, err);
    return { success: false, error: err.message };
  }
}

export async function getProjectLogs(id: string, serviceName?: string): Promise<string> {
  try {
    const docker = getDocker();
    const containers = await docker.listContainers({ all: true });
    const target = containers.find((c) => {
      if (id === 'standalone-containers') return cleanName(c) === serviceName;
      return (
        c.Labels['com.docker.compose.project'] === id &&
        (serviceName ? c.Labels['com.docker.compose.service'] === serviceName : true)
      );
    });
    if (!target) return 'Container not found';
    const logs = await docker.getContainer(target.Id).logs({
      stdout: true,
      stderr: true,
      tail: 200,
      timestamps: false,
    });
    return logs.toString('utf8').replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim();
  } catch (err: any) {
    console.error('Failed to get logs:', err);
    return `Error retrieving logs: ${err.message}`;
  }
}
