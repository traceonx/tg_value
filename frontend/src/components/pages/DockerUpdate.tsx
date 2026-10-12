import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { systemClient, type DockerUpdateStatus } from '../../services/clients/systemClient';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';

export function DockerUpdate() {
    const { t } = useTranslation();
    const [status, setStatus] = useState<DockerUpdateStatus | null>(null);
    const [isConfirming, setIsConfirming] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [hasError, setHasError] = useState(false);
    const [isOffline, setIsOffline] = useState(false);
    const submitting = useRef(false);
    const revision = useRef(0);
    const mounted = useRef(false);
    useEffect(() => {
        mounted.current = true;
        let stopped = false;
        let timer: ReturnType<typeof setTimeout>;
        let controller: AbortController;
        const poll = async () => {
            const version = revision.current;
            controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15_000);
            try {
                const next = await systemClient.getDockerUpdate(controller.signal);
                if (!stopped && !submitting.current && version === revision.current) { setStatus(next); setIsOffline(false); }
            } catch { if (!stopped) setIsOffline(true); }
            finally {
                clearTimeout(timeout);
                if (!stopped) timer = setTimeout(() => void poll(), 5_000);
            }
        };
        void poll();
        return () => { stopped = true; mounted.current = false; controller?.abort(); clearTimeout(timer); };
    }, []);
    const isBusy = status?.phase === 'preparing' || status?.phase === 'running';
    const start = async () => {
        if (submitting.current) return;
        submitting.current = true;
        revision.current++;
        setIsSubmitting(true);
        setIsConfirming(false);
        setHasError(false);
        try {
            const next = await systemClient.startDockerUpdate();
            if (mounted.current) setStatus(next);
        } catch { if (mounted.current) setHasError(true); }
        finally { submitting.current = false; if (mounted.current) setIsSubmitting(false); }
    };
    const message = isOffline ? (isBusy ? 'reconnecting' : 'requestFailed')
        : !status ? 'loading' : !status.enabled ? 'disabled'
        : !status.available ? 'unavailable' : status.phase;
    return <div className="border-t border-border/50 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium">{t('updates.docker.title')}</p>
                <p className="text-xs text-muted-foreground" role="status">{t(`updates.docker.${message}`)}</p>
            </div>
            <Button size="sm" variant="outline" disabled={!status?.available || isBusy || isSubmitting || isOffline}
                onClick={() => setIsConfirming(true)}>{t(isBusy || isSubmitting ? 'updates.docker.upgrading' : 'updates.docker.upgrade')}</Button>
        </div>
        {hasError && <p role="alert" className="text-sm text-destructive">{t('updates.docker.requestFailed')}</p>}
        <Dialog open={isConfirming} onClose={() => setIsConfirming(false)} labelledBy="docker-update-title" describedBy="docker-update-description" className="w-full max-w-md rounded-xl bg-card p-6 shadow-xl">
            <h3 id="docker-update-title" className="font-semibold">{t('updates.docker.confirmTitle')}</h3>
            <p id="docker-update-description" className="mt-3 text-sm text-muted-foreground">{t('updates.docker.confirm')}</p>
            <div className="mt-5 flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsConfirming(false)}>{t('common.actions.cancel')}</Button>
                <Button onClick={() => void start()}>{t('updates.docker.upgrade')}</Button>
            </div>
        </Dialog>
    </div>;
}
