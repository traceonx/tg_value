import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { useState } from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [name, value] of Object.entries({
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
const { cleanup, render, screen } = await import('@testing-library/react');
const userEvent = (await import('@testing-library/user-event')).default;
const { Switch } = await import('./Switch');
const { Tabs } = await import('./Tabs');
const { ProgressBar } = await import('./ProgressBar');
const { Chip } = await import('./Chip');
const { Card, CardHeader } = await import('./Card');
const { StatCard } = await import('./StatCard');

afterEach(() => cleanup());
after(() => {
    dom.window.close();
    for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete (globalThis as Record<string, unknown>)[name];
    }
});

test('Switch reports and toggles its state', async () => {
    const changes: boolean[] = [];
    function Harness() {
        const [on, setOn] = useState(false);
        return <Switch checked={on} label="Auto" onChange={next => { changes.push(next); setOn(next); }} />;
    }
    const user = userEvent.setup({ document: dom.window.document });
    render(<Harness />);
    const toggle = screen.getByRole('switch', { name: 'Auto' });
    assert.equal(toggle.getAttribute('aria-checked'), 'false');
    await user.click(toggle);
    assert.equal(toggle.getAttribute('aria-checked'), 'true');
    assert.deepEqual(changes, [true]);
});

test('Tabs mark the selected tab and switch on click', async () => {
    function Harness() {
        const [tab, setTab] = useState<'a' | 'b'>('a');
        return <Tabs label="Views" value={tab} onChange={setTab} items={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B', count: 3 }]} />;
    }
    const user = userEvent.setup({ document: dom.window.document });
    render(<Harness />);
    assert.equal(screen.getByRole('tab', { name: 'A' }).getAttribute('aria-selected'), 'true');
    await user.click(screen.getByRole('tab', { name: /B/ }));
    assert.equal(screen.getByRole('tab', { name: /B/ }).getAttribute('aria-selected'), 'true');
});

test('ProgressBar clamps its value and exposes it to assistive tech', () => {
    render(<><ProgressBar value={140} label="over" /><ProgressBar value={Number.NaN} label="bad" /></>);
    assert.equal(screen.getByRole('progressbar', { name: 'over' }).getAttribute('aria-valuenow'), '100');
    assert.equal(screen.getByRole('progressbar', { name: 'bad' }).getAttribute('aria-valuenow'), '0');
});

test('Card, StatCard and Chip render their content', () => {
    render(<Card><CardHeader title="Panel" description="Details" action={<button type="button">Go</button>} /><StatCard label="Files" value={12} unit="items" /><Chip tone="success">Online</Chip></Card>);
    assert.ok(screen.getByRole('heading', { name: 'Panel' }));
    assert.ok(screen.getByText('Details'));
    assert.ok(screen.getByRole('button', { name: 'Go' }));
    assert.ok(screen.getByRole('region', { name: 'Files' }));
    assert.ok(screen.getByText('Online'));
});
