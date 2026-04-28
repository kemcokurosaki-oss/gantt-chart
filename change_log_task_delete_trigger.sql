-- タスク削除時に change_log へ「削除直前」の行内容を書き込む（Supabase SQL Editor で実行）
-- 組立工程表など別クライアントからの DELETE でも、OLD の列が確実に残るため履歴が空になりにくい。
--
-- 記録対象は gantt-app.js の isAssemblyTaskRow と同じ条件の tasks のみ。
-- Realtime 側の DELETE 用 insert は gantt-app.js で行わないため、本トリガー未適用だと
-- 「組立工程表からの削除」が change_log に出ない点に注意。

CREATE OR REPLACE FUNCTION public.tr_log_assembly_task_delete_change_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p text;
  m text;
BEGIN
  p := trim(both from coalesce(OLD.parent, ''));
  m := trim(both from coalesce(OLD.major_item, ''));

  IF p IN ('組立全体', '外観検査', '試運転', '客先立会', '出荷確認会議', '出荷')
     OR p IN ('タスクリスト作成', '出荷準備')
     OR (p = '' AND m = '組立')
  THEN
    INSERT INTO public.change_log (
      source,
      project_number,
      machine,
      unit,
      task_text,
      description
    ) VALUES (
      '組立工程表',
      coalesce(OLD.project_number::text, ''),
      coalesce(OLD.machine::text, ''),
      coalesce(OLD.unit::text, ''),
      coalesce(OLD.text::text, ''),
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
