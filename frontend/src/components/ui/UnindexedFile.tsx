import { useTranslation } from 'react-i18next';
import type { FileData } from '../../services/api';

export function UnindexedFile({ file }: { file: FileData }) {
    const { t } = useTranslation();
    return <div className="h-full min-h-[64px] rounded-xl border border-border bg-card p-4 space-y-2">
        <h4 className="font-medium break-all">{file.name}</h4>
        <p className="text-xs text-muted-foreground">{file.size} · {file.date}</p>
        <p className="text-xs text-muted-foreground">{t('files.unindexedReadOnly')}</p>
    </div>;
}
