import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock3, HardDrive, ListChecks, Rss, Send, Database } from 'lucide-react';
import fileApi from '../../services/api';
import { tasksClient } from '../../services/clients/tasksClient';
import { formatBytes } from '../../services/formatBytes';
import type { StorageStats, TelegramBotPublicConfig, TelegramSubscription, TelegramUserAccountsOverview, UnifiedTask } from '../../services/apiTypes';
import { Card, CardHeader } from '../ui/Card';
import { Chip, type Tone } from '../ui/Chip';
import { ProgressBar } from '../ui/ProgressBar';
import { StatCard } from '../ui/StatCard';

const ACTIVE_STATUSES = ['running', 'pending', 'waiting', 'paused'];
const ISSUE_STATUSES = ['failed', 'interrupted', 'retry_required'];

export interface DashboardData {
    tasks: UnifiedTask[] | null;
    subscriptions: TelegramSubscription[] | null;
    bot: TelegramBotPublicConfig | null;
    accounts: TelegramUserAccountsOverview | null;
}

export async function loadDashboardData(): Promise<DashboardData> {
    const [tasks, subscriptions, bot, accounts] = await Promise.all([
        tasksClient.getTasks({ limit: 100 }).then(list => list.tasks).catch(() => null),
        fileApi.getSubscriptions({ limit: 6 }).then(list => list.subscriptions).catch(() => null),
        fileApi.getTelegramBotConfig().catch(() => null),
        fileApi.getTelegramUserAccounts().catch(() => null),
    ]);
    return { tasks, subscriptions, bot, accounts };
}

export function DashboardPage({ storageStats, onNavigate, load = loadDashboardData }: {
    storageStats: StorageStats | null;
    onNavigate: (category: string) => void;
    load?: () => Promise<DashboardData>;
}) {
    const { t } = useTranslation();
    const [data, setData] = useState<DashboardData | null>(null);

    const refresh = useCallback(async () => {
        const next = await load();
        setData(next);
        return next;
    }, [load]);

    useEffect(() => {
        let stopped = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const tick = async () => {
            const next = await refresh().catch(() => null);
            if (stopped) return;
            const busy = next?.tasks?.some(task => ACTIVE_STATUSES.includes(task.status));
            timer = setTimeout(() => void tick(), busy ? 5_000 : 30_000);
        };
        void tick();
        return () => { stopped = true; if (timer) clearTimeout(timer); };
    }, [refresh]);

    const tasks = data?.tasks ?? [];
    const running = tasks.filter(task => task.status === 'running').length;
    const queued = tasks.filter(task => ['pending', 'waiting'].includes(task.status)).length;
    const issues = tasks.filter(task => ISSUE_STATUSES.includes(task.status)).length;
    const activeTasks = tasks.filter(task => ACTIVE_STATUSES.includes(task.status)).slice(0, 5);

    const quota = storageStats?.remoteQuota ?? (storageStats ? { usedBytes: storageStats.server.usedBytes, totalBytes: storageStats.server.totalBytes, usedPercent: storageStats.server.usedPercent } : null);
    const botReady = data?.bot?.status === 'ready';
    const accountSummary = data?.accounts?.summary;

    return (
        <div className="mx-auto w-full max-w-7xl space-y-6">
            <div>
                <h2 className="text-2xl font-semibold tracking-tight">{t('dashboard.title')}</h2>
                <p className="text-sm text-muted-foreground">{t('dashboard.subtitle')}</p>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard icon={HardDrive} tone="primary" label={t('dashboard.storage.title')}>
                    {quota ? <>
                        <p className="text-2xl font-semibold">{formatBytes(quota.usedBytes)} <span className="text-sm font-normal text-muted-foreground">/ {formatBytes(quota.totalBytes)}</span></p>
                        <ProgressBar value={quota.usedPercent} label={t('dashboard.storage.title')} />
                    </> : <p className="text-sm text-muted-foreground">{t('dashboard.loading')}</p>}
                </StatCard>
                <StatCard icon={Database} tone="info" label={t('dashboard.library.title')}>
                    <p className="text-2xl font-semibold">{storageStats ? storageStats.tgvault.fileCount.toLocaleString() : '—'} <span className="text-sm font-normal text-muted-foreground">{t('dashboard.library.files')}</span></p>
                    <p className="text-sm text-muted-foreground">{storageStats ? t('dashboard.library.used', { size: formatBytes(storageStats.tgvault.usedBytes) }) : ''}</p>
                </StatCard>
                <StatCard icon={Clock3} tone="warning" label={t('dashboard.tasks.title')}>
                    <p className="text-2xl font-semibold">{data?.tasks ? running : '—'} <span className="text-sm font-normal text-muted-foreground">{t('dashboard.tasks.summary', { queued })}</span></p>
                    {issues > 0
                        ? <button type="button" onClick={() => onNavigate('tasks')} className="self-start text-sm font-medium text-destructive hover:underline">{t('dashboard.tasks.issues', { count: issues })}</button>
                        : <p className="text-sm text-muted-foreground">{t('dashboard.tasks.noIssues')}</p>}
                </StatCard>
                <StatCard icon={Send} tone="success" label="Telegram">
                    <div className="flex flex-wrap gap-2">
                        {data?.bot ? <Chip tone={botReady ? 'success' : data.bot.configured ? 'warning' : 'neutral'}>{t(botReady ? 'dashboard.telegram.botOnline' : data.bot.configured ? 'dashboard.telegram.botOffline' : 'dashboard.telegram.botMissing')}</Chip> : null}
                        {accountSummary ? <Chip tone={accountSummary.ready > 0 ? 'success' : 'neutral'}>{t('dashboard.telegram.accounts', { ready: accountSummary.ready, total: accountSummary.total })}</Chip> : null}
                    </div>
                    <p className="text-sm text-muted-foreground">{data?.bot?.bot?.username ? `@${data.bot.bot.username}` : t('dashboard.telegram.hint')}</p>
                </StatCard>
            </div>

            <div className="flex flex-wrap items-start gap-6">
                <Card className="min-w-0 flex-[999_1_520px]">
                    <CardHeader icon={ListChecks} title={t('dashboard.active.title')}
                        action={<button type="button" onClick={() => onNavigate('tasks')} className="text-sm font-medium text-primary hover:underline">{t('dashboard.viewAll')}</button>} />
                    {activeTasks.length === 0
                        ? <p className="px-5 py-10 text-center text-sm text-muted-foreground">{data?.tasks ? t('dashboard.active.empty') : t('dashboard.loading')}</p>
                        : <ul className="divide-y divide-border">
                            {activeTasks.map(task => (
                                <li key={`${task.sourceType}:${task.id}`} className="flex flex-col gap-2 px-5 py-4">
                                    <div className="flex items-baseline gap-3">
                                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{task.title}</span>
                                        <span className="shrink-0 text-xs text-muted-foreground">
                                            {task.status === 'running' ? `${Math.round(task.progress)}%` : t(`tasks.statuses.${task.status === 'retry_required' ? 'retryRequired' : task.status}`)}
                                            {task.bytes.total > 0 ? ` · ${formatBytes(task.bytes.transferred)} / ${formatBytes(task.bytes.total)}` : ''}
                                        </span>
                                    </div>
                                    <ProgressBar value={task.progress} label={task.title} />
                                </li>
                            ))}
                        </ul>}
                </Card>

                <Card className="min-w-0 flex-[1_1_320px]">
                    <CardHeader icon={Rss} title={t('dashboard.subscriptions.title')}
                        action={<button type="button" onClick={() => onNavigate('subscriptions')} className="text-sm font-medium text-primary hover:underline">{t('dashboard.viewAll')}</button>} />
                    {!data?.subscriptions?.length
                        ? <p className="px-5 py-10 text-center text-sm text-muted-foreground">{data?.subscriptions ? t('dashboard.subscriptions.empty') : t('dashboard.loading')}</p>
                        : <ul className="divide-y divide-border">
                            {data.subscriptions.map(sub => {
                                const name = sub.title || sub.source;
                                const state: [Tone, string] = sub.last_error ? ['danger', 'dashboard.subscriptions.error']
                                    : sub.enabled ? ['success', 'dashboard.subscriptions.syncing'] : ['neutral', 'dashboard.subscriptions.paused'];
                                return (
                                    <li key={sub.id} className="flex items-center gap-3 px-5 py-3">
                                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent font-semibold text-accent-foreground" aria-hidden="true">{name.replace(/^@/, '').slice(0, 1).toUpperCase()}</span>
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-sm font-medium">{name}</p>
                                            <p className="truncate text-xs text-muted-foreground">{sub.last_success_at ? t('dashboard.subscriptions.lastSync', { time: new Date(sub.last_success_at).toLocaleString() }) : sub.source}</p>
                                        </div>
                                        <Chip tone={state[0]}>{t(state[1])}</Chip>
                                    </li>
                                );
                            })}
                        </ul>}
                </Card>
            </div>
        </div>
    );
}
