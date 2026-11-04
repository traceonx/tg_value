import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

export type Tone = 'primary' | 'info' | 'warning' | 'success' | 'danger' | 'neutral';

/** Tinted background with a darker foreground of the same hue; every pair passes 4.5:1. */
export const TONE_CLASSES: Record<Tone, string> = {
    primary: 'bg-accent text-accent-foreground',
    info: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200',
    warning: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200',
    success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200',
    danger: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-200',
    neutral: 'bg-muted text-muted-foreground',
};

/** Pill-shaped status label. */
export function Chip({ tone = 'neutral', icon, children, className }: { tone?: Tone; icon?: ReactNode; children: ReactNode; className?: string }) {
    return (
        <span className={cn('inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-xs font-medium', TONE_CLASSES[tone], className)}>
            {icon}{children}
        </span>
    );
}
