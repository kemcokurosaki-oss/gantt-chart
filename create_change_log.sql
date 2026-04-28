-- 全体工程表 更新履歴テーブル
-- Supabase の SQL Editor で実行してください

CREATE TABLE IF NOT EXISTS public.change_log (
    id             BIGSERIAL PRIMARY KEY,
    changed_at     TIMESTAMPTZ DEFAULT NOW(),
    source         TEXT,   -- 変更元（例: "全体工程表" / "設計工程表" / "組立工程表"）
    project_number TEXT,
    machine        TEXT,
    unit           TEXT,
    task_text      TEXT,   -- タスク名
    description    TEXT    -- 変更内容（例: "開始日を変更しました"）
);

-- 全ユーザーが読み取り可能
ALTER TABLE public.change_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read change_log" ON public.change_log;
CREATE POLICY "Allow public read change_log"
    ON public.change_log FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow auth insert change_log" ON public.change_log;
CREATE POLICY "Allow auth insert change_log"
    ON public.change_log FOR INSERT WITH CHECK (true);

-- パフォーマンス用インデックス
CREATE INDEX IF NOT EXISTS idx_change_log_changed_at      ON public.change_log(changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_change_log_source          ON public.change_log(source);
CREATE INDEX IF NOT EXISTS idx_change_log_project_number  ON public.change_log(project_number);
