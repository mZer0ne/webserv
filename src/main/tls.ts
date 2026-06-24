import {app} from 'electron';
import {join} from 'path';
import {existsSync, mkdirSync, writeFileSync, rmSync} from 'fs';
import {execFile, exec} from 'child_process';
import {promisify} from 'util';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

const CA_COMMON_NAME = 'WebServ Local CA';
/** Where site certs are mounted inside the web container. */
export const CERT_MOUNT = '/etc/webserv/certs';

function caDir(): string {
    const d = join(app.getPath('userData'), 'ca');
    mkdirSync(d, {recursive: true});
    return d;
}

export function certsHostDir(): string {
    const d = join(caDir(), 'certs');
    mkdirSync(d, {recursive: true});
    return d;
}

export function caCertPath(): string {
    return join(caDir(), 'rootCA.crt');
}

function caKeyPath(): string {
    return join(caDir(), 'rootCA.key');
}

export async function ensureCA(): Promise<void> {
    if (existsSync(caCertPath()) && existsSync(caKeyPath())) return;
    await execFileAsync('openssl', ['genrsa', '-out', caKeyPath(), '2048']);
    await execFileAsync('openssl', [
        'req', '-x509', '-new', '-nodes', '-key', caKeyPath(),
        '-sha256', '-days', '3650', '-out', caCertPath(),
        '-subj', `/CN=${CA_COMMON_NAME}/O=WebServ`,
    ]);
}

/** Generate (once) a leaf cert for a domain signed by the local CA. Returns host paths. */
export async function certForDomain(domain: string): Promise<{ crt: string; key: string }> {
    await ensureCA();
    const dir = certsHostDir();
    const crt = join(dir, `${domain}.crt`);
    const key = join(dir, `${domain}.key`);
    if (existsSync(crt) && existsSync(key)) return {crt, key};

    const csr = join(dir, `${domain}.csr`);
    const ext = join(dir, `${domain}.ext`);
    writeFileSync(
        ext,
        `[v3]\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:${domain}\n`,
        'utf8'
    );
    await execFileAsync('openssl', ['genrsa', '-out', key, '2048']);
    await execFileAsync('openssl', ['req', '-new', '-key', key, '-out', csr, '-subj', `/CN=${domain}`]);
    await execFileAsync('openssl', [
        'x509', '-req', '-in', csr, '-CA', caCertPath(), '-CAkey', caKeyPath(),
        '-CAcreateserial', '-out', crt, '-days', '825', '-sha256',
        '-extfile', ext, '-extensions', 'v3',
    ]);
    rmSync(csr, {force: true});
    rmSync(ext, {force: true});
    return {crt, key};
}

export interface CaStatus {
    generated: boolean;
    trusted: boolean;
}

export async function caStatus(): Promise<CaStatus> {
    const generated = existsSync(caCertPath());
    let trusted = false;
    if (generated && process.platform === 'darwin') {
        try {
            await execFileAsync('security', ['find-certificate', '-c', CA_COMMON_NAME, '/Library/Keychains/System.keychain']);
            trusted = true;
        } catch {
            trusted = false;
        }
    }
    return {generated, trusted};
}

/** Install the root CA into the macOS System keychain as a trusted root (prompts for admin). */
export async function installCA(): Promise<{ success: boolean; error?: string }> {
    try {
        await ensureCA();
        if (process.platform === 'darwin') {
            const cmd = `osascript -e 'do shell script "security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain \\"${caCertPath()}\\"" with administrator privileges'`;
            await execAsync(cmd);
        }
        return {success: true};
    } catch (err: any) {
        return {success: false, error: err.message};
    }
}
