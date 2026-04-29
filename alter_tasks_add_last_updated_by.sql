-- tasks テーブルに最終更新者カラムを追加
-- 設計工程表が編集者名を書き込み、全体工程表の同期処理がそれを change_log に転記します
-- Supabase の SQL Editor で実行してください

ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS last_updated_by TEXT;
