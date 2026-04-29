-- change_log テーブルに変更者カラムを追加
-- Supabase の SQL Editor で実行してください

-- ① changed_by 列を追加
ALTER TABLE public.change_log
ADD COLUMN IF NOT EXISTS changed_by TEXT;

-- ② delete_task_with_change_log_source を p_user パラメータ追加で更新
CREATE OR REPLACE FUNCTION public.delete_task_with_change_log_source(
    p_task_id text,
    p_source  text DEFAULT '全体工程表',
    p_user    text DEFAULT ''
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_src  text;
  v_user text;
BEGIN
  v_src  := trim(both from coalesce(p_source, ''));
  v_user := trim(both from coalesce(p_user,   ''));
  IF v_src = '' THEN
    v_src := '全体工程表';
  END IF;
  PERFORM set_config('app.delete_change_log_source', v_src,  true);
  PERFORM set_config('app.change_user',              v_user, true);
  DELETE FROM public.tasks
  WHERE id::text = trim(both from p_task_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_task_with_change_log_source(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_task_with_change_log_source(text, text, text) TO service_role;

-- ③ 削除トリガーを changed_by 対応で更新
CREATE OR REPLACE FUNCTION public.tr_log_assembly_task_delete_change_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p     text;
  m     text;
  src   text;
  uname text;
BEGIN
  p     := trim(both from coalesce(OLD.parent,     ''));
  m     := trim(both from coalesce(OLD.major_item, ''));
  uname := trim(both from coalesce(
      nullif(trim(both from coalesce(current_setting('app.change_user', true), '')), ''),
      coalesce(OLD.last_updated_by, '')
  ));

  src := '組立工程表';
  IF current_setting('app.delete_change_log_source', true) IS NOT NULL
     AND length(trim(both from current_setting('app.delete_change_log_source', true))) > 0
  THEN
    src := trim(both from current_setting('app.delete_change_log_source', true));
  END IF;

  IF p IN ('組立全体', '外観検査', '試運転', '客先立会', '出荷確認会議', '出荷')
     OR p IN ('タスクリスト作成', '出荷準備')
     OR (p = '' AND m = '組立')
     OR src = '全体工程表'
  THEN
    INSERT INTO public.change_log (
      source,
      changed_by,
      project_number,
      machine,
      unit,
      task_text,
      description
    ) VALUES (
      src,
      uname,
      coalesce(OLD.project_number::text, ''),
      coalesce(OLD.machine::text,        ''),
      coalesce(OLD.unit::text,           ''),
      coalesce(OLD.text::text,           ''),
      'タスクを削除しました'
    );
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS tr_tasks_log_assembly_delete ON public.tasks;

CREATE TRIGGER tr_tasks_log_assembly_delete
  AFTER DELETE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.tr_log_assembly_task_delete_change_log();
