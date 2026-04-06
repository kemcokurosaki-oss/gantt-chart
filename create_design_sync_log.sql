-- 工程表間の同期履歴テーブル（汎用版）
-- Supabase の SQL Editor で実行してください

CREATE TABLE IF NOT EXISTS public.sync_log (
    id             BIGSERIAL PRIMARY KEY,
    synced_at      TIMESTAMPTZ DEFAULT NOW(),
    source         TEXT,        -- 連携元（例: '設計工程表', '組立工程表'）
    project_number TEXT,
    machine        TEXT,
    unit           TEXT,
    old_start_date DATE,
    old_duration   INTEGER,
    new_start_date DATE,
    new_duration   INTEGER
);

-- 全ユーザーが読み取り可能
ALTER TABLE public.sync_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read sync_log" ON public.sync_log;
CREATE POLICY "Allow public read sync_log"
    ON public.sync_log FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow auth insert sync_log" ON public.sync_log;
CREATE POLICY "Allow auth insert sync_log"
    ON public.sync_log FOR INSERT WITH CHECK (true);

-- パフォーマンス用インデックス
CREATE INDEX IF NOT EXISTS idx_sync_log_synced_at ON public.sync_log(synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_log_source    ON public.sync_log(source);
