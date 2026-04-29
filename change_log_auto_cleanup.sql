-- change_log 自動クリーンアップ設定
-- 3ヶ月より古いレコードを毎日深夜0時に自動削除します
-- Supabase の SQL Editor で実行してください

-- ① pg_cron 拡張を有効化（既に有効な場合はスキップされます）
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ② 既存のジョブが残っている場合は削除（再実行時の重複防止）
SELECT cron.unschedule('change_log_cleanup')
WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'change_log_cleanup'
);

-- ③ 毎日 0:00 (UTC) に3ヶ月より古いレコードを削除するジョブを登録
SELECT cron.schedule(
    'change_log_cleanup',           -- ジョブ名
    '0 0 * * *',                    -- 毎日 0:00 UTC（日本時間 9:00）
    $$
        DELETE FROM public.change_log
        WHERE changed_at < NOW() - INTERVAL '3 months';
    $$
);

-- ④ 登録確認（ジョブ一覧を表示）
SELECT jobid, jobname, schedule, command, active
FROM cron.job
WHERE jobname = 'change_log_cleanup';
