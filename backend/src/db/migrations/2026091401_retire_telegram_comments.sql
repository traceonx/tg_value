-- Preserve downloaded files and history, but never resume removed discussion downloads.
UPDATE telegram_download_items
SET status = 'skipped',
    last_error = 'Comment downloads have been removed',
    completed_at = NOW(), locked_at = NULL,
    lease_token = NULL, lease_expires_at = NULL
WHERE origin = 'comment' AND status IN ('pending', 'downloading', 'failed');

UPDATE telegram_background_jobs
SET params = params - 'includeComments' - 'commentsMaxPerPost',
    scan_cursor = scan_cursor - 'commentMessagesScanned' - 'commentMediaFound'
WHERE params ?| ARRAY['includeComments', 'commentsMaxPerPost']
   OR scan_cursor ?| ARRAY['commentMessagesScanned', 'commentMediaFound'];
