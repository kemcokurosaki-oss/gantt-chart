-- 既存の change_log に変更元カラムを追加（未適用環境向け）
-- Supabase の SQL Editor で実行してください

ALTER TABLE public.change_log
ADD COLUMN IF NOT EXISTS source TEXT;

CREATE INDEX IF NOT EXISTS idx_change_log_source
ON public.change_log(source);
