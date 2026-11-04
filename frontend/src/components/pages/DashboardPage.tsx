import { useCallback, useEffect, useState, type ElementType, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock3, HardDrive, ListChecks, Rss, Send, Database } from 'lucide-react';
import fileApi from '../../services/api';
import { tasksClient } from '../../services/clients/tasksClient';
import { formatBytes } from '../../services/formatBytes';
import type { StorageStats, TelegramBotPublicConfig, TelegramSubscription, TelegramUserAccountsOverview, UnifiedTask } from '../../services/apiTypes';
import { cn } from '../../lib/utils';

const ACTIVE_STATUSES = ['running', 'pending', 'waiting', 'paused'];
const ISSUE_STATUSES = ['failed', 'interrupted', 'retry_required'];

export interface DashboardData {
    tasks: UnifiedTask[] | null;
    subscriptions: TelegramSubscription[] | null;
    bot: TelegramBotPublicConfig | null;
    accounts: TelegramUserAccountsOverview | null;
}

type Tone = 'primary' | 'info' | 'warning' | 'success' | 'danger' | 'neutral';
const TONES: Record<Tone, string> = {
    primary: 'bg-accent text-accent-foreground',
    info: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200',
    warning: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200',
    success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200',
    danger: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-200',
    neutral: 'bg-muted text-muted-foreground',
};

function Chip({ tone, children }: { tone: Tone; children: ReactNode }) {
    return <span className={cn('inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium', TONES[tone])}>{children}</span>;
}

function StatCard({ icon: Icon, tone, label, children }: { icon: ElementType; tone: Tone; label: string; children: ReactNode }) {
    return (
        <section className="flex flex-col gap-3 rounded-lg bg-card p-5 shadow-card" aria-label={label}>
            <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-normal text-muted-foreground">{label}</h3>
                <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', TONES[tone])}><Icon className="h-5 w-5" aria-hidden="true" /></span>
            </div>
            {children}
        </section>
    );
}

function Meter({ percent, label }: { percent: number; label: string }) {
    const value = Math.max(0, Math.min(100, Math.round(percent)));
    return (
        <div role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${value}%` }} />
        </div>
    );
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
                        <Meter percent={quota.usedPercent} label={t('dashboard.storage.title')} />
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
                <section className="min-w-0 flex-[999_1_520px] overflow-hidden rounded-lg bg-card shadow-card">
                    <header className="flex items-center gap-3 border-b border-border px-5 py-4">
                        <ListChecks className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                        <h3 className="flex-1 text-lg font-semibold">{t('dashboard.active.title')}</h3>
                        <button type="button" onClick={() => onNavigate('tasks')} className="text-sm font-medium text-primary hover:underline">{t('dashboard.viewAll')}</button>
                    </header>
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
                                    <Meter percent={task.progress} label={task.title} />
                                </li>
                            ))}
                        </ul>}
                </section>

                <section className="min-w-0 flex-[1_1_320px] overflow-hidden rounded-lg bg-card shadow-card">
                    <header className="flex items-center gap-3 border-b border-border px-5 py-4">
                        <Rss className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                        <h3 className="flex-1 text-lg font-semibold">{t('dashboard.subscriptions.title')}</h3>
                        <button type="button" onClick={() => onNavigate('subscriptions')} className="text-sm font-medium text-primary hover:underline">{t('dashboard.viewAll')}</button>
                    </header>
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
                </section>
            </div>
        </div>
    );
}
