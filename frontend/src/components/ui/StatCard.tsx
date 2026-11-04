import type { ElementType, ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { Card } from './Card';
import { TONE_CLASSES, type Tone } from './Chip';

/** Summary tile: label and tinted icon on top, value and detail below. */
export function StatCard({ icon: Icon, tone = 'primary', label, value, unit, children, className }: {
    icon?: ElementType;
    tone?: Tone;
    label: string;
    value?: ReactNode;
    unit?: ReactNode;
    children?: ReactNode;
    className?: string;
}) {
    return (
        <Card aria-label={label} className={cn('flex flex-col gap-3 p-5', className)}>
            <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-normal text-muted-foreground">{label}</h3>
                {Icon && <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', TONE_CLASSES[tone])}><Icon className="h-5 w-5" aria-hidden="true" /></span>}
            </div>
            {value !== undefined && <p className="text-2xl font-semibold">{value}{unit !== undefined && <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span>}</p>}
            {children}
        </Card>
    );
}
