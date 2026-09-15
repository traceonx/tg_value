// GramJS can call _connectSender concurrently when several file iterators
// borrow the same disconnected exported sender. Share one connection attempt.
export function installTelegramSenderConnectionGuard(client: {
    _connectSender: (...args: any[]) => Promise<any>;
}): void {
    const connect = client._connectSender.bind(client);
    const connecting = new Map<number, Promise<any>>();
    client._connectSender = (sender: unknown, dcId: number) => {
        const current = connecting.get(dcId);
        if (current) return current;
        const pending = Promise.resolve().then(() => connect(sender, dcId)).finally(() => {
            if (connecting.get(dcId) === pending) connecting.delete(dcId);
        });
        connecting.set(dcId, pending);
        return pending;
    };
}
