import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';

const SOCKET = '/var/run/docker.sock';
const IMAGE = 'containrrr/watchtower:1.7.1';
const LABEL = 'io.tg-vault.update-job';
type Phase = 'idle' | 'preparing' | 'running' | 'success' | 'unchanged' | 'failed';
interface Job {
    phase: Phase;
    id?: string;
    target?: string;
    image?: string;
    helper?: string;
    startedAt?: string;
}
interface Container {
    Id: string;
    Name: string;
    Image: string;
    Config: { Image: string; Hostname?: string; Labels?: Record<string, string> };
    Mounts?: { Destination: string; Source: string; RW: boolean }[];
    State: { Running: boolean; Status: string; ExitCode: number; Health?: { Status: string } };
}
export interface DockerUpdateStatus {
    enabled: boolean;
    available: boolean;
    phase: Phase;
    startedAt?: string;
}
export class DockerError extends Error {
    constructor(public status: number) { super(`Docker API returned ${status}`); }
}
export type DockerRequest = (method: string, route: string, body?: unknown, timeout?: number) => Promise<string>;

// No shell commands or caller-controlled Docker endpoints are accepted.
export const dockerRequest: DockerRequest = (method, route, body, timeout = 10_000) => new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({ socketPath: SOCKET, path: route, method,
        headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
    }, res => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > 8 * 1024 * 1024) { req.destroy(new Error('Docker response too large')); return; }
            chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => {
            const status = res.statusCode || 500;
            if (status < 200 || status >= 300) reject(new DockerError(status));
            else resolve(Buffer.concat(chunks).toString('utf8'));
        });
    });
    const timer = setTimeout(() => req.destroy(new Error('Docker request timed out')), timeout);
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject);
    req.end(payload);
});

export function readSummary(logs: string): { scanned: number; updated: number; failed: number } | null {
    for (const line of logs.split('\n').reverse()) {
        try {
            const row = JSON.parse(line);
            if (row.msg !== 'Session done') continue;
            const values = [row.Scanned, row.Updated, row.Failed].map(Number);
            if (!values.every(value => Number.isInteger(value) && value >= 0)) return null;
            return { scanned: values[0], updated: values[1], failed: values[2] };
        } catch { /* Other log lines are not proof of success. */ }
    }
    return null;
}

export function createDockerUpdater(options: {
    enabled?: boolean; stateFile?: string; hostname?: string; request?: DockerRequest; monitor?: boolean;
} = {}) {
    const enabled = options.enabled ?? process.env.DOCKER_UPDATE_ENABLED === 'true';
    const stateFile = options.stateFile ?? '/data/docker-update.json';
    const hostname = options.hostname ?? os.hostname();
    const request = options.request ?? dockerRequest;
    let job: Job = { phase: 'idle' };
    let corrupt = false;
    let preparing = false;
    let checking: Promise<void> | undefined;
    let lastError = '';
    if (enabled && fs.existsSync(stateFile)) {
        // Fail closed on a corrupt record instead of risking a second updater.
        try {
            job = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as Job;
            if (!job || !['idle', 'preparing', 'running', 'success', 'unchanged', 'failed'].includes(job.phase)) throw new Error('Invalid Docker update state');
            if (['preparing', 'running'].includes(job.phase) && (!job.id || !job.helper || !job.target || !job.image)) throw new Error('Incomplete Docker update state');
        } catch { corrupt = true; job = { phase: 'failed' }; }
    }
    const save = () => {
        fs.mkdirSync(path.dirname(stateFile), { recursive: true });
        fs.writeFileSync(`${stateFile}.tmp`, JSON.stringify(job), { mode: 0o600 });
        fs.renameSync(`${stateFile}.tmp`, stateFile);
    };
    const inspect = async (name: string) => JSON.parse(await request('GET', `/containers/${encodeURIComponent(name)}/json`)) as Container;
    const busy = () => job.phase === 'preparing' || job.phase === 'running';
    const self = async () => {
        if (!/^[a-f0-9]{12,64}$/.test(hostname)) throw new Error('Default Docker hostname required');
        let container: Container;
        try { container = await inspect(hostname); }
        catch (error) {
            // Watchtower preserves the old hostname when it replaces our ID.
            // Only use the target recorded by our own previous update job.
            if (!(error instanceof DockerError) || error.status !== 404 || !job.target) throw error;
            container = await inspect(job.target);
        }
        const recordedSelf = job.target && container.Name === `/${job.target}` && container.Config.Hostname === hostname;
        if ((!container.Id.startsWith(hostname) && !recordedSelf) || !container.State.Running || !container.Name.startsWith('/')) throw new Error('Cannot identify this container');
        if (container.Config.Image.includes('@sha256:') || container.Config.Image.startsWith('sha256:')) throw new Error('A mutable image tag is required');
        if (!container.Mounts?.some(mount => mount.Destination === '/data' && mount.RW)) throw new Error('Persistent /data required');
        if (!container.Mounts?.some(mount => mount.Destination === SOCKET && mount.Source === SOCKET)) throw new Error('Standard Docker socket mount required');
        const labels = container.Config.Labels || {};
        if (labels['com.docker.swarm.service.name'] || labels['com.centurylinklabs.watchtower.enable'] === 'false'
            || labels['com.centurylinklabs.watchtower.monitor-only'] === 'true') throw new Error('Container does not permit updates');
        return container;
    };
    const reconcile = async () => {
        if ((preparing && busy()) || !job.helper || !job.id) return;
        let helper: Container;
        try { helper = await inspect(job.helper); }
        catch (error) {
            if (error instanceof DockerError && error.status === 404) {
                if (busy()) job.phase = 'failed';
                delete job.helper;
                save();
                return;
            }
            throw error;
        }
        if (helper.Config.Labels?.[LABEL] !== job.id) throw new Error('Updater identity mismatch');
        if (helper.State.Running) return;
        if (busy()) {
            const logs = await request('GET', `/containers/${encodeURIComponent(job.helper)}/logs?stdout=1&stderr=1&tail=200`);
            fs.writeFileSync(path.join(path.dirname(stateFile), 'docker-update.log'), logs.slice(-32_768), { mode: 0o600 });
            const summary = readSummary(logs);
            if (helper.State.Status !== 'exited' || helper.State.ExitCode !== 0 || !summary || summary.failed || summary.scanned !== 1) {
                job.phase = 'failed';
            } else {
                const target = await inspect(job.target!);
                if (!target.State.Running || target.State.Health?.Status === 'unhealthy') job.phase = 'failed';
                else if (target.State.Health?.Status === 'starting') return;
                else if (target.State.Health?.Status !== 'healthy') job.phase = 'failed';
                else if (summary.updated === 1 && target.Image !== job.image) job.phase = 'success';
                else if (summary.updated === 0 && target.Image === job.image) job.phase = 'unchanged';
                else job.phase = 'failed';
            }
            save();
        }
        // Retain the helper until its result is persisted, including across our restart.
        await request('DELETE', `/containers/${encodeURIComponent(job.helper)}`);
        delete job.helper;
        save();
    };
    const refresh = () => {
        if (!checking) checking = reconcile().finally(() => { checking = undefined; });
        return checking;
    };
    const status = async (): Promise<DockerUpdateStatus> => {
        if (!enabled) return { enabled: false, available: false, phase: 'idle' };
        if (corrupt) return { enabled, available: false, phase: 'failed' };
        try {
            await refresh();
            await self();
            lastError = '';
            return { enabled, available: true, phase: job.phase, startedAt: job.startedAt };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message !== lastError) console.warn('Docker upgrade unavailable:', message);
            lastError = message;
            return { enabled, available: false, phase: job.phase, startedAt: job.startedAt };
        }
    };
    const prepare = async (apiVersion: string, socket: string) => {
        try {
            try { await request('GET', `/images/${encodeURIComponent(IMAGE)}/json`); }
            catch (error) {
                if (!(error instanceof DockerError) || error.status !== 404) throw error;
                const pull = await request('POST', `/images/create?fromImage=${encodeURIComponent('containrrr/watchtower')}&tag=1.7.1`, undefined, 600_000);
                for (const line of pull.split('\n').filter(Boolean)) {
                    const row = JSON.parse(line);
                    if (row.error || row.errorDetail) throw new Error('Updater image pull failed');
                }
            }
            await request('POST', `/containers/create?name=${encodeURIComponent(job.helper!)}`, {
                Image: IMAGE,
                Cmd: ['--run-once', '--log-format', 'JSON', '--stop-timeout', '60s', job.target],
                Env: [`DOCKER_API_VERSION=${apiVersion}`, `DOCKER_HOST=unix://${SOCKET}`],
                Tty: true,
                Labels: { [LABEL]: job.id, 'com.centurylinklabs.watchtower.enable': 'false' },
                HostConfig: { Binds: [`${socket}:${SOCKET}`], RestartPolicy: { Name: 'no' },
                    LogConfig: { Type: 'json-file', Config: { 'max-size': '1m', 'max-file': '1' } } },
            });
            job.phase = 'running';
            save();
            await request('POST', `/containers/${encodeURIComponent(job.helper!)}/start`);
        } catch (error) {
            console.error('Docker update preparation failed:', error);
            // A start timeout is ambiguous: reconciliation must inspect the helper.
            if (job.phase !== 'running') { job.phase = 'failed'; save(); }
        } finally { preparing = false; }
    };
    const start = async () => {
        if (!enabled) throw new DockerError(403);
        if (corrupt) throw new DockerError(503);
        if (preparing || busy()) throw new DockerError(409);
        preparing = true;
        try {
            await refresh();
            const target = await self();
            const version = JSON.parse(await request('GET', '/version')) as { ApiVersion: string };
            if (!/^1\.\d+$/.test(version.ApiVersion)) throw new Error('Invalid Docker API version');
            const name = target.Name.slice(1);
            job = { phase: 'preparing', id: randomUUID(), target: name, image: target.Image,
                helper: `tg-vault-update-${createHash('sha256').update(name).digest('hex').slice(0, 16)}`,
                startedAt: new Date().toISOString() };
            save();
            void prepare(version.ApiVersion, SOCKET).catch(error => console.error('Could not persist Docker update result:', error));
            return { enabled, available: true, phase: job.phase, startedAt: job.startedAt } satisfies DockerUpdateStatus;
        } catch (error) { preparing = false; throw error; }
    };
    const timer = enabled && options.monitor !== false ? setInterval(() => {
        if (job.helper && !preparing) void refresh().catch(() => undefined);
    }, 5_000) : undefined;
    timer?.unref();
    return { status, start, close: () => { if (timer) clearInterval(timer); } };
}
