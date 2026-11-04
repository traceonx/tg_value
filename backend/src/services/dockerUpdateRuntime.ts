import { createDockerUpdater } from './dockerUpdater.js';
import { createDockerAutoUpdater } from './dockerAutoUpdate.js';

// One updater per process: the web API, the Bot and the auto-update scheduler
// must share the same job state so two upgrades can never start concurrently.
let updater: ReturnType<typeof createDockerUpdater> | undefined;
let autoUpdater: ReturnType<typeof createDockerAutoUpdater> | undefined;

export function getDockerUpdater(): ReturnType<typeof createDockerUpdater> {
    updater ??= createDockerUpdater();
    return updater;
}

export function getDockerAutoUpdater(): ReturnType<typeof createDockerAutoUpdater> {
    autoUpdater ??= createDockerAutoUpdater({ updater: getDockerUpdater() });
    return autoUpdater;
}
