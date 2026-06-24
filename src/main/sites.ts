import Store from 'electron-store';
import {app} from 'electron';
import {join, relative, posix} from 'path';
import {existsSync, mkdirSync, writeFileSync, rmSync, readdirSync} from 'fs';
import {
    getDocker,
    ensureNetwork,
    connectToNetwork,
} from './docker.js';
import {composeUpService, isWebServComposeContainer} from './compose.js';
import {getSettings, setSettings} from './settings.js';
import {syncHosts} from './hosts.js';
import {certForDomain, certsHostDir, CERT_MOUNT} from './tls.js';

const certPathFor = (domain: string) => `${CERT_MOUNT}/${domain}.crt`;
const keyPathFor = (domain: string) => `${CERT_MOUNT}/${domain}.key`;

export type SiteType = 'app' | 'proxy';

export interface Site {
    id: string;
    domain: string;
    type: SiteType;      // 'app' = serve files; 'proxy' = reverse-proxy to a container
    root: string;        // app: absolute host path (must live under sitesRoot)
    php: string | null;  // app: PHP version like "8.3", or null for static
    target: string;      // proxy: target container name / host on the network
    targetPort: number;  // proxy: target port
    createdAt: string;
}

interface SitesStore {
    sites: Site[];
}

const store = new Store<SitesStore>({name: 'webserv-sites', defaults: {sites: []}});

const CONTAINER_MOUNT = '/var/www';

function confDir(): string {
    const dir = join(app.getPath('userData'), 'web', 'conf.d');
    mkdirSync(dir, {recursive: true});
    return dir;
}

function phpContainerName(version: string): string {
    return `webserv-rt-php-${version}`;
}

/** Map an absolute host path under sitesRoot to its path inside the shared containers. */
function containerRoot(hostPath: string): string | null {
    const {sitesRoot} = getSettings();
    const rel = relative(sitesRoot, hostPath);
    if (rel.startsWith('..') || posix.isAbsolute(rel.split('\\').join('/'))) return null;
    return posix.join(CONTAINER_MOUNT, rel.split('\\').join('/'));
}

type WebEngine = 'nginx' | 'apache';

function webEngine(): WebEngine {
    return getSettings().web.engine === 'apache' ? 'apache' : 'nginx';
}

function webImage(engine: WebEngine): string {
    return engine === 'apache' ? 'httpd:2.4' : 'nginx:alpine';
}

/** Where the per-vhost conf directory is mounted inside the container. */
function confMountPath(engine: WebEngine): string {
    return engine === 'apache' ? '/usr/local/apache2/conf/webserv.d' : '/etc/nginx/conf.d';
}

function nginxVhost(site: Site, root: string, httpPort: number): string {
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
    listen 443 ssl;
    server_name ${site.domain};
    ssl_certificate ${certPathFor(site.domain)};
    ssl_certificate_key ${keyPathFor(site.domain)};
    root ${root};
    index index.php index.html index.htm;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }
${phpBlock}
}
`;
}

function apacheVhost(site: Site, root: string): string {
    const phpBlock = site.php
        ? `
    <FilesMatch \\.php$>
        SetHandler "proxy:fcgi://${phpContainerName(site.php)}:9000"
    </FilesMatch>`
        : '';
    const body = `    ServerName ${site.domain}
    DocumentRoot "${root}"
    DirectoryIndex index.php index.html index.htm
    <Directory "${root}">
        AllowOverride All
        Require all granted
    </Directory>${phpBlock}`;
    return `# Managed by WebServ — ${site.domain}
<VirtualHost *:80>
${body}
</VirtualHost>
<VirtualHost *:443>
${body}
    SSLEngine on
    SSLCertificateFile ${certPathFor(site.domain)}
    SSLCertificateKeyFile ${keyPathFor(site.domain)}
</VirtualHost>
`;
}

function nginxProxyVhost(site: Site): string {
    return `# Managed by WebServ — ${site.domain} (proxy)
server {
    listen 80;
    listen 443 ssl;
    server_name ${site.domain};
    ssl_certificate ${certPathFor(site.domain)};
    ssl_certificate_key ${keyPathFor(site.domain)};

    location / {
        # Resolve the target lazily via Docker's embedded DNS so nginx still starts
        # (and other sites keep working) even if this container is down — yields 502, not [emerg].
        resolver 127.0.0.11 valid=10s ipv6=off;
        set $webserv_upstream http://${site.target}:${site.targetPort};
        proxy_pass $webserv_upstream$request_uri;
        # Preserve the original host:port so apps (e.g. Laravel) build correct URLs/redirects.
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $http_host;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
`;
}

function apacheProxyVhost(site: Site): string {
    const up = `http://${site.target}:${site.targetPort}/`;
    const body = `    ServerName ${site.domain}
    ProxyPreserveHost On
    ProxyPass / ${up}
    ProxyPassReverse / ${up}`;
    return `# Managed by WebServ — ${site.domain} (proxy)
<VirtualHost *:80>
${body}
</VirtualHost>
<VirtualHost *:443>
${body}
    SSLEngine on
    SSLCertificateFile ${certPathFor(site.domain)}
    SSLCertificateKeyFile ${keyPathFor(site.domain)}
</VirtualHost>
`;
}

function vhostConf(site: Site): string {
    if (site.type === 'proxy') {
        return webEngine() === 'apache' ? apacheProxyVhost(site) : nginxProxyVhost(site);
    }
    const root = containerRoot(site.root) || CONTAINER_MOUNT;
    const {httpPort} = getSettings().web;
    return webEngine() === 'apache' ? apacheVhost(site, root) : nginxVhost(site, root, httpPort);
}

const HTTPD_CONF = `# Managed by WebServ — Apache front controller
ServerRoot "/usr/local/apache2"
Listen 80
Listen 443
LoadModule mpm_event_module modules/mod_mpm_event.so
LoadModule ssl_module modules/mod_ssl.so
LoadModule socache_shmcb_module modules/mod_socache_shmcb.so
LoadModule authz_core_module modules/mod_authz_core.so
LoadModule dir_module modules/mod_dir.so
LoadModule mime_module modules/mod_mime.so
LoadModule log_config_module modules/mod_log_config.so
LoadModule unixd_module modules/mod_unixd.so
LoadModule proxy_module modules/mod_proxy.so
LoadModule proxy_fcgi_module modules/mod_proxy_fcgi.so
LoadModule proxy_http_module modules/mod_proxy_http.so
LoadModule rewrite_module modules/mod_rewrite.so
LoadModule setenvif_module modules/mod_setenvif.so
LoadModule headers_module modules/mod_headers.so
User daemon
Group daemon
ServerName localhost
TypesConfig conf/mime.types
ErrorLog /proc/self/fd/2
LogLevel warn
DirectoryIndex index.php index.html
<Directory />
    AllowOverride none
    Require all denied
</Directory>
IncludeOptional conf/webserv.d/*.conf
`;

function httpdConfPath(): string {
    const file = join(app.getPath('userData'), 'web', 'httpd.conf');
    writeFileSync(file, HTTPD_CONF, 'utf8');
    return file;
}

// ---------------------------------------------------------------------------
// Shared nginx web server
// ---------------------------------------------------------------------------

async function findContainer(name: string) {
    const containers = await getDocker().listContainers({all: true});
    return containers.find((c) => (c.Names || []).some((n) => n.replace(/^\//, '') === name));
}

async function removeContainer(id: string, running?: boolean): Promise<void> {
    const container = getDocker().getContainer(id);
    if (running) await container.stop().catch(() => {
    });
    await container.remove({force: true});
}

export async function ensureWeb(): Promise<void> {
    const docker = getDocker();
    const {web, networkName, sitesRoot} = getSettings();
    await ensureNetwork(networkName);
    mkdirSync(sitesRoot, {recursive: true});
    const dir = confDir();
    await writeAllConfs();   // regenerate vhosts (+ certs) so template/engine changes are picked up

    // Bring up the PHP-FPM runtimes the sites depend on, otherwise nginx fails
    // to start with "host not found in upstream".
    const phpVersions = new Set(listSites().map((s) => s.php).filter((v): v is string => !!v));
    for (const v of phpVersions) {
        await ensurePhp(v).catch((e) => console.error(`ensurePhp ${v} failed:`, e));
    }

    const engine = webEngine();
    const image = webImage(engine);

    let found = await findContainer(web.containerName);
    if (found) {
        // Recreate if the port, image (engine switch) or management changed.
        try {
            const info = await docker.getContainer(found.Id).inspect();
            const hp = info.HostConfig?.PortBindings?.['80/tcp']?.[0]?.HostPort;
            const hps = info.HostConfig?.PortBindings?.['443/tcp']?.[0]?.HostPort;
            const imageMismatch = (info.Config?.Image || '') !== image;
            if (hp !== String(web.httpPort) || hps !== String(web.httpsPort) || imageMismatch || !isWebServComposeContainer(found)) {
                await removeContainer(found.Id, info.State?.Running);
                found = undefined;
            }
        } catch {
            /* fall through */
        }
    }

    if (!found) {
        const volumes = [
            `${sitesRoot}:${CONTAINER_MOUNT}:ro`,
            `${dir}:${confMountPath(engine)}:ro`,
            `${certsHostDir()}:${CERT_MOUNT}:ro`,
        ];
        if (engine === 'apache') {
            volumes.push(`${httpdConfPath()}:/usr/local/apache2/conf/httpd.conf:ro`);
        }
        await composeUpService('web', {
            container_name: web.containerName,
            image,
            labels: {'com.webserv.managed': 'true', 'com.webserv.role': 'web'},
            ports: [`${web.httpPort}:80`, `${web.httpsPort}:443`],
            volumes,
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
    const {web} = getSettings();
    const found = await findContainer(web.containerName);
    if (!found || found.State !== 'running') return;
    const cmd = webEngine() === 'apache' ? ['httpd', '-k', 'graceful'] : ['nginx', '-s', 'reload'];
    try {
        const exec = await getDocker().getContainer(found.Id).exec({
            Cmd: cmd,
            AttachStdout: true,
            AttachStderr: true,
        });
        await exec.start({});
    } catch {
        await getDocker().getContainer(found.Id).restart().catch(() => {
        });
    }
}

export async function setWebEngine(engine: WebEngine): Promise<{ success: boolean; error?: string }> {
    try {
        const {web} = getSettings();
        setSettings({web: {...web, engine, image: webImage(engine)}});
        await ensureWeb();
        return {success: true};
    } catch (err: any) {
        return {success: false, error: err.message};
    }
}

/** Ensure the PHP-FPM runtime for a version exists and mounts the sites root. */
async function ensurePhp(version: string): Promise<void> {
    const docker = getDocker();
    const {networkName, sitesRoot} = getSettings();
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

async function writeAllConfs(): Promise<void> {
    const dir = confDir();
    for (const f of readdirSync(dir)) {
        if (f.endsWith('.conf')) rmSync(join(dir, f), {force: true});
    }
    for (const site of listSites()) {
        // ensure a CA-signed cert exists for the domain before referencing it in the vhost
        await certForDomain(site.domain).catch((e) => console.error(`cert for ${site.domain} failed:`, e));
        writeFileSync(join(dir, `${site.domain}.conf`), vhostConf(site), 'utf8');
    }
}

export interface AddSiteInput {
    domain: string;
    type?: SiteType;
    root?: string;
    php?: string | null;
    target?: string;
    targetPort?: number;
}

/** Validate input and build a normalized Site (or return an error). */
function buildSite(input: AddSiteInput, createdAt: string): { site?: Site; error?: string } {
    const domain = input.domain.trim().replace(/^https?:\/\//, '').split('/')[0];
    if (!domain) return {error: 'Invalid domain'};
    const type: SiteType = input.type === 'proxy' ? 'proxy' : 'app';

    if (type === 'proxy') {
        const target = (input.target || '').trim();
        const targetPort = Number(input.targetPort);
        if (!target) return {error: 'Target container is required'};
        if (!targetPort) return {error: 'Target port is required'};
        return {site: {id: domain, domain, type, root: '', php: null, target, targetPort, createdAt}};
    }

    const root = input.root || '';
    if (!existsSync(root)) return {error: 'Folder does not exist'};
    if (!containerRoot(root)) {
        return {error: `Folder must live under sites root (${getSettings().sitesRoot})`};
    }
    return {site: {id: domain, domain, type, root, php: input.php ?? null, target: '', targetPort: 0, createdAt}};
}

/** Attach a proxy target container to the app network so the web server can resolve it by name. */
async function connectProxyTarget(site: Site): Promise<void> {
    if (site.type !== 'proxy') return;
    const {networkName} = getSettings();
    const containers = await getDocker().listContainers({all: true});
    const c = containers.find((x) => (x.Names || []).some((n) => n.replace(/^\//, '') === site.target));
    if (c) await connectToNetwork(networkName, c.Id).catch(() => {
    });
}

async function applySite(site: Site): Promise<void> {
    await writeAllConfs();
    if (site.php) await ensurePhp(site.php);
    await connectProxyTarget(site);
    await ensureWeb();
    await reloadWeb();
    await applyHosts();
}

export async function addSite(
    input: AddSiteInput
): Promise<{ success: boolean; site?: Site; error?: string }> {
    const {site, error} = buildSite(input, new Date().toISOString());
    if (error || !site) return {success: false, error};
    if (listSites().some((s) => s.domain === site.domain)) {
        return {success: false, error: `Site ${site.domain} already exists`};
    }
    try {
        store.set('sites', [...listSites(), site]);
        await applySite(site);
        return {success: true, site};
    } catch (err: any) {
        return {success: false, error: err.message};
    }
}

export async function updateSite(
    id: string,
    input: AddSiteInput
): Promise<{ success: boolean; site?: Site; error?: string }> {
    const current = listSites().find((s) => s.id === id);
    if (!current) return {success: false, error: 'Site not found'};

    const {site, error} = buildSite(input, current.createdAt);
    if (error || !site) return {success: false, error};
    if (site.domain !== id && listSites().some((s) => s.domain === site.domain)) {
        return {success: false, error: `Site ${site.domain} already exists`};
    }

    try {
        store.set('sites', listSites().map((s) => (s.id === id ? site : s)));
        await applySite(site);
        return {success: true, site};
    } catch (err: any) {
        return {success: false, error: err.message};
    }
}

export async function removeSite(id: string): Promise<{ success: boolean; error?: string }> {
    try {
        store.set('sites', listSites().filter((s) => s.id !== id));
        await writeAllConfs();
        await reloadWeb();
        await applyHosts();
        return {success: true};
    } catch (err: any) {
        return {success: false, error: err.message};
    }
}

export interface WebStatus {
    installed: boolean;
    running: boolean;
    httpPort: number;
    httpsPort: number;
    sitesRoot: string;
    engine: WebEngine;
}

export async function getWebStatus(): Promise<WebStatus> {
    const {web, sitesRoot} = getSettings();
    const found = await findContainer(web.containerName);
    return {
        installed: !!found,
        running: found?.State === 'running',
        httpPort: web.httpPort,
        httpsPort: web.httpsPort,
        sitesRoot,
        engine: webEngine(),
    };
}

export async function stopWeb(): Promise<void> {
    const {web} = getSettings();
    const found = await findContainer(web.containerName);
    if (found && found.State === 'running') {
        await getDocker().getContainer(found.Id).stop();
    }
}

export async function removeWeb(): Promise<void> {
    const {web} = getSettings();
    const found = await findContainer(web.containerName);
    if (found) await getDocker().getContainer(found.Id).remove({force: true});
}
