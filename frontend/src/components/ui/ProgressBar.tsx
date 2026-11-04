import { cn } from '../../lib/utils';

/** Rounded progress track; `value` is a percentage and is clamped to 0–100. */
export function ProgressBar({ value, label, size = 'md', className, barClassName }: {
    value: number;
    label: string;
    size?: 'sm' | 'md';
    className?: string;
    barClassName?: string;
}) {
    const percent = Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));
    return (
        <div
            role="progressbar"
            aria-label={label}
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            className={cn('overflow-hidden rounded-full bg-muted', size === 'sm' ? 'h-1.5' : 'h-2', className)}
        >
            <div className={cn('h-full rounded-full bg-primary transition-[width] duration-300', barClassName)} style={{ width: `${percent}%` }} />
        </div>
    );
}
