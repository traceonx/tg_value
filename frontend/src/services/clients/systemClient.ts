import type { UpdateStatus } from '../apiTypes';
import { apiRequest } from '../httpClient';
import { tr } from '../../i18n/runtime';
import { getApiHeaders } from './clientHeaders';

export interface DockerUpdateStatus {
    enabled: boolean;
    available: boolean;
    phase: 'idle' | 'preparing' | 'running' | 'success' | 'unchanged' | 'failed';
    startedAt?: string;
}

export class SystemClient {
    async getDockerUpdate(signal?: AbortSignal): Promise<DockerUpdateStatus> {
        const response = await apiRequest('/api/system/docker-update', {
            cache: 'no-store', headers: getApiHeaders(), signal,
        });
        return response.json();
    }

    async startDockerUpdate(): Promise<DockerUpdateStatus> {
        const response = await apiRequest('/api/system/docker-update', {
            method: 'POST', cache: 'no-store',
            headers: getApiHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ confirm: true }),
            fallback: tr('updates.docker.requestFailed'),
        });
        return response.json();
    }
    async getUpdateStatus(): Promise<UpdateStatus> {
        const response = await apiRequest('/api/system/update-status', {
            credentials: 'include',
            cache: 'no-store',
            headers: getApiHeaders(),
        });
        if (!response.ok) throw new Error(tr('errors.services.system.getVersionFailed'));
        return response.json();
    }

    async checkForUpdates(): Promise<UpdateStatus> {
        const response = await apiRequest('/api/system/update-check', {
            method: 'POST',
            credentials: 'include',
            cache: 'no-store',
            headers: getApiHeaders(),
        });
        if (response.status === 429) throw new Error(tr('errors.services.system.updateCheckRateLimited'));
        if (!response.ok) throw new Error(tr('errors.services.system.checkVersionFailed'));
        return response.json();
    }

    async healthCheck(): Promise<{ status: string; timestamp: string }> {
        const response = await apiRequest('/health');
        if (!response.ok) throw new Error(tr('errors.services.system.healthCheckFailed'));
        return response.json();
    }
}

export const systemClient = new SystemClient();
