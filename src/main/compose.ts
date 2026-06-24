import {app} from 'electron';
import {execFile} from 'child_process';
import {existsSync, mkdirSync, writeFileSync} from 'fs';
import {join} from 'path';
import {promisify} from 'util';
import {stringify} from 'yaml';
import type {ContainerInfo} from 'dockerode';
import {getSettings} from './settings.js';

const execFileAsync = promisify(execFile);

export const WEBSERV_COMPOSE_PROJECT = 'webserv';

type ComposeService = Record<string, unknown>;

function dockerBin(): string {
    const candidates = process.platform === 'win32'
        ? [
            'docker.exe',
            'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe',
            'C:\\Program Files\\Docker\\Docker\\resources\\docker.exe',
        ]
        : ['/usr/local/bin/docker', '/opt/homebrew/bin/docker', 'docker'];

    for (const p of candidates) {
        if (existsSync(p)) return p;
    }
    return 'docker';
}

function dockerHostArgs(): string[] {
    const configured = getSettings().dockerSocketPath.trim();
    if (/^(tcp|http|https|npipe):\/\//i.test(configured)) {
        return ['--host', configured];
    }
    const normalizedPipe = configured.replace(/\\/g, '/');
    if (process.platform === 'win32' && /^\/\/\.\/pipe\/docker_engine/i.test(normalizedPipe)) {
        return ['--host', `npipe:////./pipe/docker_engine`];
    }
    return [];
}

function composeDir(): string {
    const dir = join(app.getPath('userData'), 'compose');
    mkdirSync(dir, {recursive: true});
    return dir;
}

function composePath(serviceName: string): string {
    return join(composeDir(), `${serviceName}.yml`);
}

function buildCompose(serviceName: string, service: ComposeService, networkName: string): Record<string, unknown> {
    return {
        services: {
            [serviceName]: service,
        },
        networks: {
            [networkName]: {
                external: true,
            },
        },
    };
}

export function isWebServComposeContainer(container?: ContainerInfo): boolean {
    return container?.Labels?.['com.docker.compose.project'] === WEBSERV_COMPOSE_PROJECT;
}

export async function composeUpService(
    serviceName: string,
    service: ComposeService,
    networkName: string
): Promise<void> {
    const file = composePath(serviceName);
    writeFileSync(file, stringify(buildCompose(serviceName, service, networkName)), 'utf8');
    await execFileAsync(
        dockerBin(),
        [...dockerHostArgs(), 'compose', '-p', WEBSERV_COMPOSE_PROJECT, '-f', file, 'up', '-d', serviceName],
        {timeout: 180_000}
    );
}
