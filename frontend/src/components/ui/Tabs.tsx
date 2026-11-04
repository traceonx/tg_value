import { cn } from '../../lib/utils';

/** Classes for one underline tab; shared so pages with routed tabs stay consistent. */
export function underlineTabClass(active: boolean, className?: string): string {
    return cn(
        '-mb-px h-12 shrink-0 border-b-2 px-4 text-[15px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        active ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
        className,
    );
}

export const UNDERLINE_TAB_LIST_CLASS = 'flex w-full max-w-full gap-1 overflow-x-auto overscroll-x-contain border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

/** Underline tabs for switching views inside a page. */
export function Tabs<T extends string>({ items, value, onChange, label, className }: {
    items: Array<{ value: T; label: string; count?: number }>;
    value: T;
    onChange: (value: T) => void;
    label: string;
    className?: string;
}) {
    return (
        <div role="tablist" aria-label={label} className={cn(UNDERLINE_TAB_LIST_CLASS, className)}>
            {items.map(item => (
                <button key={item.value} type="button" role="tab" aria-selected={item.value === value} onClick={() => onChange(item.value)} className={underlineTabClass(item.value === value)}>
                    {item.label}{item.count !== undefined && <span className="ml-1.5 text-xs text-muted-foreground">{item.count}</span>}
                </button>
            ))}
        </div>
    );
}

/** Shared look for native inputs and selects. */
export const FIELD_CLASS = 'h-10 min-w-0 rounded-md border border-input bg-card px-3 text-sm text-foreground outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50';
