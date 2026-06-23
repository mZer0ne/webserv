import { stringify } from 'yaml';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getSettings } from './settings.js';

const execAsync = promisify(exec);

export type TemplateId = 'static' | 'php' | 'laravel' | 'wordpress' | 'node' | 'next';

export interface Template {
  id: TemplateId;
  label: string;
  description: string;
  stack: string;
}

export const TEMPLATES: Template[] = [
  { id: 'laravel', label: 'Laravel Stack', description: 'PHP + Nginx + MySQL', stack: 'Laravel' },
  { id: 'wordpress', label: 'WordPress Environment', description: 'WordPress + MySQL', stack: 'WordPress' },
  { id: 'node', label: 'Node.js Backend', description: 'Node 20 HTTP service', stack: 'Node.js Stack' },
  { id: 'next', label: 'Next.js App', description: 'Node 20 dev server', stack: 'Node.js Stack' },
  { id: 'php', label: 'PHP Environment', description: 'PHP 8.3 + Apache', stack: 'PHP Environment' },
  { id: 'static', label: 'Static Landing Page', description: 'Nginx static server', stack: 'Nginx Web Server' },
];

function dockerBin(): string {
  for (const p of ['/usr/local/bin/docker', '/opt/homebrew/bin/docker']) {
    if (existsSync(p)) return p;
  }
  return 'docker';
}

interface ComposeBundle {
  compose: Record<string, unknown>;
  files: { path: string; content: string }[];
}

function buildBundle(template: TemplateId, name: string, network: string): ComposeBundle {
  const dbPassword = 'webserv';
  const extNetwork = { networks: { default: { name: `${name}_default` }, [network]: { external: true } } };

  switch (template) {
    case 'static':
      return {
        compose: {
          services: {
            web: {
              image: 'nginx:alpine',
              volumes: ['./public:/usr/share/nginx/html:ro'],
              expose: ['80'],
              networks: ['default', network],
              restart: 'unless-stopped',
            },
          },
          ...extNetwork,
        },
        files: [{ path: 'public/index.html', content: `<!doctype html><h1>${name}</h1><p>Powered by WebServ.</p>` }],
      };

    case 'php':
      return {
        compose: {
          services: {
            web: {
              image: 'php:8.3-apache',
              volumes: ['./src:/var/www/html'],
              expose: ['80'],
              networks: ['default', network],
              restart: 'unless-stopped',
            },
          },
          ...extNetwork,
        },
        files: [{ path: 'src/index.php', content: `<?php echo "<h1>${name}</h1><p>PHP " . phpversion() . "</p>";` }],
      };

    case 'node':
    case 'next':
      return {
        compose: {
          services: {
            web: {
              image: 'node:20-alpine',
              working_dir: '/app',
              volumes: ['./app:/app'],
              command: 'node server.js',
              expose: ['3000'],
              networks: ['default', network],
              restart: 'unless-stopped',
            },
          },
          ...extNetwork,
        },
        files: [
          {
            path: 'app/server.js',
            content:
              `const http=require('http');` +
              `http.createServer((_,r)=>{r.writeHead(200);r.end('Hello from ${name} (Node ${template})');})` +
              `.listen(3000,()=>console.log('listening on 3000'));`,
          },
        ],
      };

    case 'wordpress':
      return {
        compose: {
          services: {
            web: {
              image: 'wordpress:latest',
              expose: ['80'],
              environment: {
                WORDPRESS_DB_HOST: 'db',
                WORDPRESS_DB_USER: 'wordpress',
                WORDPRESS_DB_PASSWORD: dbPassword,
                WORDPRESS_DB_NAME: 'wordpress',
              },
              depends_on: ['db'],
              networks: ['default', network],
              restart: 'unless-stopped',
            },
            db: {
              image: 'mysql:8.0',
              environment: {
                MYSQL_DATABASE: 'wordpress',
                MYSQL_USER: 'wordpress',
                MYSQL_PASSWORD: dbPassword,
                MYSQL_ROOT_PASSWORD: dbPassword,
              },
              volumes: ['db_data:/var/lib/mysql'],
              networks: ['default'],
              restart: 'unless-stopped',
            },
          },
          volumes: { db_data: {} },
          ...extNetwork,
        },
        files: [],
      };

    case 'laravel':
      return {
        compose: {
          services: {
            web: {
              image: 'webdevops/php-nginx:8.3',
              volumes: ['./app:/app'],
              expose: ['80'],
              environment: { WEB_DOCUMENT_ROOT: '/app/public' },
              depends_on: ['db'],
              networks: ['default', network],
              restart: 'unless-stopped',
            },
            db: {
              image: 'mysql:8.0',
              environment: {
                MYSQL_DATABASE: 'laravel',
                MYSQL_USER: 'laravel',
                MYSQL_PASSWORD: dbPassword,
                MYSQL_ROOT_PASSWORD: dbPassword,
              },
              volumes: ['db_data:/var/lib/mysql'],
              networks: ['default'],
              restart: 'unless-stopped',
            },
          },
          volumes: { db_data: {} },
          ...extNetwork,
        },
        files: [
          { path: 'app/public/index.php', content: `<?php echo "<h1>${name}</h1><p>Laravel placeholder — run composer create-project.</p>";` },
        ],
      };
  }
}

function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

export interface CreateProjectInput {
  name: string;
  template: TemplateId;
}

export async function createProject(
  input: CreateProjectInput
): Promise<{ success: boolean; project?: string; dir?: string; error?: string }> {
  const name = sanitizeName(input.name);
  if (!name) return { success: false, error: 'Invalid project name' };

  const { workspaceDir, networkName } = getSettings();
  const projectDir = join(workspaceDir, name);
  if (existsSync(projectDir)) {
    return { success: false, error: `Directory already exists: ${projectDir}` };
  }

  try {
    mkdirSync(projectDir, { recursive: true });
    const bundle = buildBundle(input.template, name, networkName);

    writeFileSync(join(projectDir, 'docker-compose.yml'), stringify(bundle.compose), 'utf8');
    for (const f of bundle.files) {
      const full = join(projectDir, f.path);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, f.content, 'utf8');
    }

    await execAsync(`${dockerBin()} compose -p ${name} up -d`, {
      cwd: projectDir,
      timeout: 180_000,
    });

    return { success: true, project: name, dir: projectDir };
  } catch (err: any) {
    try { rmSync(projectDir, { recursive: true, force: true }); } catch { /* best effort */ }
    return { success: false, error: err.stderr || err.message };
  }
}

export async function deleteProject(
  id: string,
  deleteVolumes: boolean
): Promise<{ success: boolean; error?: string }> {
  const { workspaceDir } = getSettings();
  const projectDir = join(workspaceDir, id);
  try {
    if (existsSync(join(projectDir, 'docker-compose.yml'))) {
      const flag = deleteVolumes ? ' -v' : '';
      await execAsync(`${dockerBin()} compose -p ${id} down${flag}`, { cwd: projectDir, timeout: 120_000 });
      rmSync(projectDir, { recursive: true, force: true });
      return { success: true };
    }
    // Not a WebServ-scaffolded project — just bring the compose stack down by name.
    await execAsync(`${dockerBin()} compose -p ${id} down`, { timeout: 120_000 }).catch(() => {});
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.stderr || err.message };
  }
}
