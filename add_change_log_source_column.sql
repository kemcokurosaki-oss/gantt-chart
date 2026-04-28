-- 既存の change_log に source 列が無い場合の追加用（Supabase SQL Editor で実行）
-- create_change_log.sql 実行済みで既に source がある場合は何もしません。

ALTER TABLE public.change_log
    ADD COLUMN IF NOT EXISTS source TEXT;

CREATE INDEX IF NOT EXISTS idx_change_log_source ON public.change_log(source);
