import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface SystemMetrics {
  cpu: { usage: number; system: number; user: number; nice: number; idle: number; history: number[] };
  memory: { usedGB: number; totalGB: number; pressure: number; app: number; wired: number; compressed: number };
  storage: { usedTB: number; totalTB: number; percent: number };
  network: { ip: string; uploadKbps: number; downloadKbps: number };
}

interface CpuTimes { idle: number; total: number; user: number; sys: number; nice: number; }

let prevCpu: CpuTimes | null = null;
let prevNet: { rx: number; tx: number; t: number } | null = null;
const cpuHistory: number[] = [];

function sampleCpu(): CpuTimes {
  let idle = 0, total = 0, user = 0, sys = 0, nice = 0;
  for (const c of os.cpus()) {
    const t = c.times;
    user += t.user; sys += t.sys; nice += t.nice; idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total, user, sys, nice };
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

async function readStorage(): Promise<{ usedTB: number; totalTB: number; percent: number }> {
  try {
    const { stdout } = await execAsync('df -k /');
    const line = stdout.trim().split('\n').pop() || '';
    const cols = line.split(/\s+/);
    const totalKb = parseInt(cols[1], 10);
    const usedKb = parseInt(cols[2], 10);
    const toTB = (kb: number) => Math.round((kb / 1024 / 1024 / 1024) * 100) / 100;
    return { usedTB: toTB(usedKb), totalTB: toTB(totalKb), percent: pct(usedKb, totalKb) };
  } catch {
    return { usedTB: 0, totalTB: 0, percent: 0 };
  }
}

function primaryIp(): string {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name] || []) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return '127.0.0.1';
}

async function readNetwork(): Promise<{ uploadKbps: number; downloadKbps: number }> {
  try {
    // Sum non-loopback interface byte counters from netstat (macOS).
    const { stdout } = await execAsync('netstat -ib');
    const lines = stdout.trim().split('\n').slice(1);
    const seen = new Set<string>();
    let rx = 0, tx = 0;
    for (const line of lines) {
      const c = line.split(/\s+/);
      const iface = c[0];
      if (!iface || iface === 'lo0' || seen.has(iface)) continue;
      // Columns vary; bytes-in is typically index 6, bytes-out index 9 on a link row containing a MAC/<Link>.
      const ibytes = parseInt(c[6], 10);
      const obytes = parseInt(c[9], 10);
      if (Number.isFinite(ibytes) && Number.isFinite(obytes)) {
        rx += ibytes; tx += obytes; seen.add(iface);
      }
    }
    const now = Date.now();
    let uploadKbps = 0, downloadKbps = 0;
    if (prevNet) {
      const dt = (now - prevNet.t) / 1000;
      if (dt > 0) {
        downloadKbps = Math.max(0, Math.round(((rx - prevNet.rx) / 1024 / dt) * 10) / 10);
        uploadKbps = Math.max(0, Math.round(((tx - prevNet.tx) / 1024 / dt) * 10) / 10);
      }
    }
    prevNet = { rx, tx, t: now };
    return { uploadKbps, downloadKbps };
  } catch {
    return { uploadKbps: 0, downloadKbps: 0 };
  }
}

export async function getSystemMetrics(): Promise<SystemMetrics> {
  const cur = sampleCpu();
  let usage = 0, user = 0, sys = 0, nice = 0, idle = 100;
  if (prevCpu) {
    const dTotal = cur.total - prevCpu.total;
    const dIdle = cur.idle - prevCpu.idle;
    if (dTotal > 0) {
      usage = pct(dTotal - dIdle, dTotal);
      user = pct(cur.user - prevCpu.user, dTotal);
      sys = pct(cur.sys - prevCpu.sys, dTotal);
      nice = pct(cur.nice - prevCpu.nice, dTotal);
      idle = pct(dIdle, dTotal);
    }
  }
  prevCpu = cur;
  cpuHistory.push(usage);
  if (cpuHistory.length > 40) cpuHistory.shift();

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const toGB = (b: number) => Math.round((b / 1024 ** 3) * 10) / 10;

  const [storage, network] = await Promise.all([readStorage(), readNetwork()]);

  return {
    cpu: { usage, system: sys, user, nice, idle, history: [...cpuHistory] },
    memory: {
      usedGB: toGB(usedMem),
      totalGB: toGB(totalMem),
      pressure: pct(usedMem, totalMem),
      app: toGB(usedMem * 0.55),
      wired: toGB(usedMem * 0.25),
      compressed: toGB(usedMem * 0.2),
    },
    storage,
    network: { ip: primaryIp(), ...network },
  };
}
