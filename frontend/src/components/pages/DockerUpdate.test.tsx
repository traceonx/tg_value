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
const { cleanup, render, screen, within, waitFor } = await import('@testing-library/react');
const userEvent = (await import('@testing-library/user-event')).default;
const { default: i18n } = await import('../../i18n');
const { systemClient } = await import('../../services/clients/systemClient');
const { DockerUpdate } = await import('./DockerUpdate');
const originalGet = systemClient.getDockerUpdate;
const originalStart = systemClient.startDockerUpdate;
afterEach(() => { cleanup(); systemClient.getDockerUpdate = originalGet; systemClient.startDockerUpdate = originalStart; });
after(() => {
    dom.window.close();
    for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete (globalThis as Record<string, unknown>)[name];
    }
});

for (const locale of ['zh-CN', 'en']) {
    test(`${locale}: upgrade requires confirmation and shows localized progress`, async () => {
        await i18n.changeLanguage(locale);
        let starts = 0;
        systemClient.getDockerUpdate = async () => ({ enabled: true, available: true, phase: 'idle' });
        systemClient.startDockerUpdate = async () => { starts++; return { enabled: true, available: true, phase: 'preparing' }; };
        const user = userEvent.setup({ document: dom.window.document });
        render(<DockerUpdate />);
        await waitFor(() => assert.equal((screen.getByRole('button', { name: i18n.t('updates.docker.upgrade') }) as HTMLButtonElement).disabled, false));
        await user.click(screen.getByRole('button', { name: i18n.t('updates.docker.upgrade') }));
        const dialog = screen.getByRole('dialog');
        assert.ok(within(dialog).getByRole('button', { name: i18n.t('common.actions.cancel') }));
        assert.ok(within(dialog).getByText(i18n.t('updates.docker.confirm')));
        assert.equal(starts, 0);
        await user.click(within(dialog).getByRole('button', { name: i18n.t('updates.docker.upgrade') }));
        assert.equal(starts, 1);
        await screen.findByText(i18n.t('updates.docker.preparing'));
        assert.equal((screen.getByRole('button', { name: i18n.t('updates.docker.upgrading') }) as HTMLButtonElement).disabled, true);
        assert.doesNotMatch(document.body.textContent || '', /updates\.docker\.|common\.actions\./);
    });
}

test('disabled deployment cannot start an upgrade', async () => {
    await i18n.changeLanguage('en');
    systemClient.getDockerUpdate = async () => ({ enabled: false, available: false, phase: 'idle' });
    render(<DockerUpdate />);
    await screen.findByText(i18n.t('updates.docker.disabled'));
    assert.equal((screen.getByRole('button', { name: i18n.t('updates.docker.upgrade') }) as HTMLButtonElement).disabled, true);
});
