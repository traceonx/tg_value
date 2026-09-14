export const menuPanels: Record<string, string[][]> = {
    download: [['tg_link'], ['tg_download']],
    files: [['list', 'find']],
    subscriptions: [['tg_sub', 'tg_subs']],
    settings: [
        ['storage', 'storage_switch'], ['target', 'path_rules'],
        ['download_workers', 'file_concurrency'], ['duplicate_mode', 'notifications'],
        ['status', 'language'], ['setup_2fa', 'logout'],
    ],
};

export const menuLabels: Record<string, Record<string, string>> = {
    zh: { download: '下载文件', files: '浏览和搜索文件', subscriptions: '频道订阅', settings: '设置' },
    en: { download: 'Download files', files: 'Browse and search files', subscriptions: 'Channel subscriptions', settings: 'Settings' },
    ru: { download: 'Скачать файлы', files: 'Просмотр и поиск файлов', subscriptions: 'Подписки на каналы', settings: 'Настройки' },
};

export const fileMenuNotes: Record<string, string> = {
    'zh-CN': '本地浏览显示磁盘上的实际文件；搜索和操作目前仅支持项目已登记的文件。',
    en: 'Local browsing shows files on disk. Search and actions currently support only files registered by the project.',
    ru: 'Локальный список показывает файлы на диске. Поиск и действия пока доступны только для зарегистрированных файлов.',
};
