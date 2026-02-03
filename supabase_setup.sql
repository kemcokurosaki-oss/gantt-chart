-- Supabase tasksテーブル作成SQL
-- このSQLをSupabaseのSQL Editorで実行してください

-- 1. tasksテーブルの作成
CREATE TABLE IF NOT EXISTS public.tasks (
    id BIGSERIAL PRIMARY KEY,
    text TEXT NOT NULL,
    owner TEXT DEFAULT '',
    start_date DATE NOT NULL,
    end_date DATE,
    duration INTEGER DEFAULT 1,
    progress NUMERIC(3, 2) DEFAULT 0 CHECK (progress >= 0 AND progress <= 1),
    project_number TEXT DEFAULT '',
    major_item TEXT DEFAULT '',
    machine TEXT DEFAULT '',
    unit TEXT DEFAULT '',
    link TEXT DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. updated_atを自動更新するトリガー関数の作成
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. updated_at自動更新トリガーの作成
DROP TRIGGER IF EXISTS update_tasks_updated_at ON public.tasks;
CREATE TRIGGER update_tasks_updated_at
    BEFORE UPDATE ON public.tasks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 4. インデックスの作成（パフォーマンス向上のため）
CREATE INDEX IF NOT EXISTS idx_tasks_start_date ON public.tasks(start_date);
CREATE INDEX IF NOT EXISTS idx_tasks_end_date ON public.tasks(end_date);
CREATE INDEX IF NOT EXISTS idx_tasks_owner ON public.tasks(owner);

-- 5. Row Level Security (RLS) の有効化
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

-- 6. RLSポリシーの作成（全ユーザーが読み書き可能にする場合）
-- 注意: 本番環境では適切な認証とポリシーを設定してください

-- 全ユーザーが読み取り可能
DROP POLICY IF EXISTS "Allow public read access" ON public.tasks;
CREATE POLICY "Allow public read access"
    ON public.tasks
    FOR SELECT
    USING (true);

-- 全ユーザーが挿入可能
DROP POLICY IF EXISTS "Allow public insert access" ON public.tasks;
CREATE POLICY "Allow public insert access"
    ON public.tasks
    FOR INSERT
    WITH CHECK (true);

-- 全ユーザーが更新可能
DROP POLICY IF EXISTS "Allow public update access" ON public.tasks;
CREATE POLICY "Allow public update access"
    ON public.tasks
    FOR UPDATE
    USING (true)
    WITH CHECK (true);

-- 全ユーザーが削除可能
DROP POLICY IF EXISTS "Allow public delete access" ON public.tasks;
CREATE POLICY "Allow public delete access"
    ON public.tasks
    FOR DELETE
    USING (true);

-- 7. サンプルデータの挿入（オプション）
-- テスト用のサンプルデータを挿入する場合は、以下のコメントを外してください
/*
INSERT INTO public.tasks (text, owner, start_date, end_date, duration, progress, project_number, major_item, machine, unit, link)
VALUES
    ('サンプルタスク1', '田中', '2024-01-01', '2024-01-10', 10, 0.5, 'P001', '設計', '機械A', 'ユニット1', ''),
    ('サンプルタスク2', '佐藤', '2024-01-05', '2024-01-15', 11, 0.3, 'P001', '開発', '機械B', 'ユニット2', ''),
    ('サンプルタスク3', '鈴木', '2024-01-10', '2024-01-20', 11, 0.0, 'P002', 'テスト', '機械C', 'ユニット3', '');
*/

-- 8. テーブル構造の確認（実行後、結果を確認してください）
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'tasks' AND table_schema = 'public'
-- ORDER BY ordinal_position;
