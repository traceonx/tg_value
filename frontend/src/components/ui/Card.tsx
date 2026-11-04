import type { ElementType, HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/utils';

/** White surface with an 8px radius and soft shadow: the base of every panel. */
export function Card({ className, as: Tag = 'section', ...props }: HTMLAttributes<HTMLElement> & { as?: ElementType }) {
    return <Tag className={cn('overflow-hidden rounded-lg bg-card text-card-foreground shadow-card', className)} {...props} />;
}

/** Card title row separated from the body by a divider. */
export function CardHeader({ icon: Icon, title, description, action, className, titleAs: Title = 'h3' }: {
    icon?: ElementType;
    title: ReactNode;
    description?: ReactNode;
    action?: ReactNode;
    className?: string;
    titleAs?: ElementType;
}) {
    return (
        <header className={cn('flex flex-wrap items-center gap-3 border-b border-border px-5 py-4', className)}>
            {Icon && <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />}
            <div className="min-w-0 flex-1">
                <Title className="text-lg font-semibold tracking-tight">{title}</Title>
                {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
            </div>
            {action}
        </header>
    );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
    return <div className={cn('p-5', className)} {...props} />;
}

/** Centered placeholder for an empty list inside or as a card. */
export function CardEmpty({ icon: Icon, title, description, className }: { icon?: ElementType; title: ReactNode; description?: ReactNode; className?: string }) {
    return (
        <div className={cn('flex flex-col items-center justify-center px-5 py-16 text-center', className)}>
            {Icon && <Icon className="h-12 w-12 text-muted-foreground/50" aria-hidden="true" />}
            <p className={cn('font-semibold', Icon && 'mt-4')}>{title}</p>
            {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
        </div>
    );
}
