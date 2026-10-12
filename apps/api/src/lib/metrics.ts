import { hostname, platform, release, arch } from 'node:os';
import { config } from '../config.js';

const value = (text: string, metric: string, labels = '') => {
  const re = new RegExp(`^${metric}${labels ? `\\{[^}]*${labels}[^}]*\\}` : '(?:\\{[^}]*\\})?'}\\s+([0-9.eE+-]+)$`, 'm');
  const match = text.match(re); return match ? Number(match[1]) : null;
};

export async function hostMetrics() {
  try {
    const scrape = async () => { const response = await fetch(config.METRICS_URL, { signal: AbortSignal.timeout(2500) }); if (!response.ok) throw new Error('metrics unavailable'); return response.text(); };
    const text = await scrape();
    if (text.trimStart().startsWith('{')) {
      const metrics = JSON.parse(text) as { source?: string; cpu?: { usagePercent?: number }; memory?: { usagePercent?: number }; storage?: unknown; system?: unknown };
      if (metrics.source !== 'HOST' || !metrics.cpu || !metrics.memory) throw new Error('Invalid host metrics response');
      return { ...metrics, source: 'HOST', status: 'Healthy' };
    }
    const memTotal = value(text, 'node_memory_MemTotal_bytes');
    const memAvail = value(text, 'node_memory_MemAvailable_bytes');
    const fsSize = value(text, 'node_filesystem_size_bytes', 'mountpoint="/host"') ?? value(text, 'node_filesystem_size_bytes', 'mountpoint="/"');
    const fsAvail = value(text, 'node_filesystem_avail_bytes', 'mountpoint="/host"') ?? value(text, 'node_filesystem_avail_bytes', 'mountpoint="/"');
    const uptime = value(text, 'node_time_seconds') && value(text, 'node_boot_time_seconds') ? value(text, 'node_time_seconds')! - value(text, 'node_boot_time_seconds')! : null;
    const load1 = value(text, 'node_load1');
    const cpuSnapshot = (source: string) => { const idle = [...source.matchAll(/^node_cpu_seconds_total\{[^}]*mode="(idle|iowait)"[^}]*\}\s+([0-9.eE+-]+)$/gm)].reduce((s,m)=>s+Number(m[2]),0); const total = [...source.matchAll(/^node_cpu_seconds_total\{[^}]*\}\s+([0-9.eE+-]+)$/gm)].reduce((s,m)=>s+Number(m[1]),0); return { idle, total }; };
    const firstCpu = cpuSnapshot(text); await new Promise(resolve => setTimeout(resolve, 250)); const secondCpu = cpuSnapshot(await scrape()); const totalDelta = secondCpu.total - firstCpu.total; const idleDelta = secondCpu.idle - firstCpu.idle;
    const cpuPercent = totalDelta > 0 ? Math.max(0, Math.min(100, 100 - idleDelta / totalDelta * 100)) : null;
    const cpuCount = new Set([...text.matchAll(/^node_cpu_seconds_total\{[^}]*cpu="(\d+)"/gm)].map(m => m[1])).size || null;
    const info = text.match(/^node_uname_info\{([^}]*)\}\s+1$/m)?.[1] ?? '';
    const label = (key: string) => info.match(new RegExp(`${key}="([^"]*)"`))?.[1] ?? null;
    return {
      source: 'HOST', status: 'Healthy',
      cpu: { model: null, cores: null, threads: cpuCount, usagePercent: cpuPercent, loadAverage: load1 },
      memory: { totalBytes: memTotal, usedBytes: memTotal !== null && memAvail !== null ? memTotal - memAvail : null, availableBytes: memAvail, usagePercent: memTotal && memAvail !== null ? (memTotal - memAvail) / memTotal * 100 : null },
      storage: { totalBytes: fsSize, usedBytes: fsSize !== null && fsAvail !== null ? fsSize - fsAvail : null, freeBytes: fsAvail, usagePercent: fsSize && fsAvail !== null ? (fsSize - fsAvail) / fsSize * 100 : null },
      system: { hostname: label('nodename'), operatingSystem: label('sysname'), kernel: label('release'), architecture: label('machine'), uptimeSeconds: uptime }
    };
  } catch {
    return { source: 'HOST', status: 'Unavailable', cpu: null, memory: null, storage: null, system: null };
  }
}

export const containerInfo = () => ({ source: 'CONTAINER', hostname: hostname(), operatingSystem: platform(), kernel: release(), architecture: arch(), appVersion: config.APP_VERSION, nodeVersion: process.version });
