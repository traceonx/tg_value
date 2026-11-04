import { cn } from '../../lib/utils';

/** On/off toggle exposed as role="switch". */
export function Switch({ checked, onChange, label, disabled, tone = 'primary', className }: {
    checked: boolean;
    onChange: (next: boolean) => void;
    label: string;
    disabled?: boolean;
    /** `danger` marks a switch whose "on" state lowers security. */
    tone?: 'primary' | 'danger';
    className?: string;
}) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            className={cn(
                'relative h-7 w-12 shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50',
                checked ? (tone === 'danger' ? 'border-destructive bg-destructive' : 'border-primary bg-primary') : 'border-border bg-muted',
                className,
            )}
        >
            <span className={cn('absolute left-0 top-0.5 h-[22px] w-[22px] rounded-full bg-white shadow-sm transition-transform', checked ? 'translate-x-6' : 'translate-x-0.5')} />
        </button>
    );
}
