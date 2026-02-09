-- Supabase tasksテーブルをコードに合わせて修正するSQL
-- このSQLをSupabaseのSQL Editorで実行してください

-- 1. 既存のテーブル構造を確認（実行前に確認用）
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'tasks' AND table_schema = 'public'
-- ORDER BY ordinal_position;

-- 2. titleカラムをtextカラムにリネーム（存在する場合）
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tasks' 
        AND column_name = 'title' 
        AND table_schema = 'public'
    ) THEN
        ALTER TABLE public.tasks RENAME COLUMN title TO text;
    END IF;
END $$;

-- 3. 不足しているカラムを追加
-- durationカラムの追加
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tasks' 
        AND column_name = 'duration' 
        AND table_schema = 'public'
    ) THEN
        ALTER TABLE public.tasks ADD COLUMN duration INTEGER DEFAULT 1;
    END IF;
END $$;

-- progressカラムの追加
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tasks' 
        AND column_name = 'progress' 
        AND table_schema = 'public'
    ) THEN
        ALTER TABLE public.tasks ADD COLUMN progress NUMERIC(3, 2) DEFAULT 0 CHECK (progress >= 0 AND progress <= 1);
    END IF;
END $$;

-- project_numberカラムの追加
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tasks' 
        AND column_name = 'project_number' 
        AND table_schema = 'public'
    ) THEN
        ALTER TABLE public.tasks ADD COLUMN project_number TEXT DEFAULT '';
    END IF;
END $$;

-- major_itemカラムの追加
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tasks' 
        AND column_name = 'major_item' 
        AND table_schema = 'public'
    ) THEN
        ALTER TABLE public.tasks ADD COLUMN major_item TEXT DEFAULT '';
    END IF;
END $$;

-- machineカラムの追加
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tasks' 
        AND column_name = 'machine' 
        AND table_schema = 'public'
    ) THEN
        ALTER TABLE public.tasks ADD COLUMN machine TEXT DEFAULT '';
    END IF;
END $$;

-- unitカラムの追加
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tasks' 
        AND column_name = 'unit' 
        AND table_schema = 'public'
    ) THEN
        ALTER TABLE public.tasks ADD COLUMN unit TEXT DEFAULT '';
    END IF;
END $$;

-- linkカラムの追加
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tasks' 
        AND column_name = 'link' 
        AND table_schema = 'public'
    ) THEN
        ALTER TABLE public.tasks ADD COLUMN link TEXT DEFAULT '';
    END IF;
END $$;

-- updated_atカラムの追加（存在しない場合）
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tasks' 
        AND column_name = 'updated_at' 
        AND table_schema = 'public'
    ) THEN
        ALTER TABLE public.tasks ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    END IF;
END $$;

-- 4. updated_atを自動更新するトリガー関数の作成（存在しない場合）
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. updated_at自動更新トリガーの作成（存在しない場合）
DROP TRIGGER IF EXISTS update_tasks_updated_at ON public.tasks;
CREATE TRIGGER update_tasks_updated_at
    BEFORE UPDATE ON public.tasks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 6. 既存データのdurationを計算（start_dateとend_dateから）
UPDATE public.tasks
SET duration = CASE
    WHEN start_date IS NOT NULL AND end_date IS NOT NULL THEN
        GREATEST(1, (end_date - start_date)::INTEGER + 1)
    ELSE
        COALESCE(duration, 1)
END
WHERE duration IS NULL OR duration < 1;

-- 7. textカラムがNOT NULL制約を持たないようにする（既存データがある場合）
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tasks' 
        AND column_name = 'text' 
        AND table_schema = 'public'
        AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE public.tasks ALTER COLUMN text DROP NOT NULL;
    END IF;
END $$;

-- 8. インデックスの作成（パフォーマンス向上のため）
CREATE INDEX IF NOT EXISTS idx_tasks_start_date ON public.tasks(start_date);
CREATE INDEX IF NOT EXISTS idx_tasks_end_date ON public.tasks(end_date);
CREATE INDEX IF NOT EXISTS idx_tasks_owner ON public.tasks(owner);

-- 11. sort_order_machineカラムの追加（機械別表示パターンの並び順保存用）
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tasks' 
        AND column_name = 'sort_order_machine' 
        AND table_schema = 'public'
    ) THEN
        ALTER TABLE public.tasks ADD COLUMN sort_order_machine INTEGER DEFAULT 0;
    END IF;
END $$;

-- 9. テーブル構造の確認（実行後に確認用）
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'tasks' AND table_schema = 'public'
-- ORDER BY ordinal_position;

-- 10. サンプルデータの確認（実行後に確認用）
-- SELECT * FROM public.tasks LIMIT 5;
