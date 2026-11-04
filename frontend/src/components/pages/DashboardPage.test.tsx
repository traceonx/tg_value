import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [name, value] of Object.entries({
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage,
    HTMLElement: dom.window.HTMLElement, Node: dom.window.Node,
    MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
const { cleanup, render, screen } = await import('@testing-library/react');
const userEvent = (await import('@testing-library/user-event')).default;
const { default: i18n } = await import('../../i18n');
const { DashboardPage } = await import('./DashboardPage');
type Data = Awaited<ReturnType<typeof import('./DashboardPage').loadDashboardData>>;

afterEach(() => cleanup());
after(() => {
    dom.window.close();
    for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete (globalThis as Record<string, unknown>)[name];
    }
});

const task = (id: string, status: string, progress: number) => ({
    id, sourceType: 'telegram_channel', kind: 'channel_download', title: `Task ${id}`, status, stage: status, progress,
    ownerUserId: 1, chatId: '1', source: '@c', target: { provider: 'local', accountId: null, accountName: null, folder: null },
    counts: { total: 1, completed: 0, failed: 0 }, bytes: { total: 0, transferred: 0 }, detail: {}, error: null,
    retryable: false, cancellable: true, createdAt: '', updatedAt: '', startedAt: null, finishedAt: null,
}) as unknown as NonNullable<Data['tasks']>[number];

const data: Data = {
    tasks: [task('1', 'running', 40), task('2', 'pending', 0), task('3', 'failed', 10), task('4', 'completed', 100)],
    subscriptions: [{ id: 's1', source: '@news', title: 'News', enabled: true, last_error: null, last_success_at: null } as unknown as NonNullable<Data['subscriptions']>[number]],
    bot: { configured: true, status: 'ready', bot: { username: 'vault_bot', displayName: null } } as unknown as Data['bot'],
    accounts: { summary: { total: 2, ready: 1 } } as unknown as Data['accounts'],
};

for (const locale of ['zh-CN', 'en']) {
    test(`${locale}: dashboard summarises tasks, Telegram and subscriptions`, async () => {
        await i18n.changeLanguage(locale);
        const visited: string[] = [];
        const user = userEvent.setup({ document: dom.window.document });
        render(<DashboardPage storageStats={null} onNavigate={category => visited.push(category)} load={async () => data} />);
        await screen.findByText('Task 1');
        assert.ok(screen.getByText('Task 2'));
        assert.equal(screen.queryByText('Task 4'), null, 'completed tasks stay off the active list');
        assert.ok(screen.getByText(i18n.t('dashboard.telegram.botOnline')));
        assert.ok(screen.getByText(i18n.t('dashboard.telegram.accounts', { ready: 1, total: 2 })));
        assert.ok(screen.getByText('News'));
        await user.click(screen.getByRole('button', { name: i18n.t('dashboard.tasks.issues', { count: 1 }) }));
        assert.deepEqual(visited, ['tasks']);
        assert.doesNotMatch(document.body.textContent || '', /dashboard\./);
    });
}
