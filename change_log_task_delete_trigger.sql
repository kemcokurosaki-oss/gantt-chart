-- タスク削除時に change_log へ「削除直前」の行内容を書き込む（Supabase SQL Editor で実行）
--
-- 変更元の振り分け:
--   - 全体工程表は RPC delete_task_with_change_log_source を呼ぶ（削除直前に set_config で変更元を渡す）
--   - 組立工程表など、通常の DELETE のみのクライアントは設定が無い → 既定で「組立工程表」
--
-- 記録対象:
--   - 組立系タスク（isAssemblyTaskRow と同じ parent / major 条件）→ 変更元は src（既定 組立工程表）
--   - または RPC で source が「全体工程表」のときは上記に限らず 1 行記録（全体工程表の logChange と二重にしないため）
-- Realtime 側の DELETE 用 insert は gantt-app.js で行わない（本トリガーに任せる）。

-- 全体工程表から削除するときに呼ぶ（gantt-events.js）
CREATE OR REPLACE FUNCTION public.delete_task_with_change_log_source(p_task_id text, p_source text DEFAULT '全体工程表')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_src text;
BEGIN
  v_src := trim(both from coalesce(p_source, ''));
  IF v_src = '' THEN
    v_src := '全体工程表';
  END IF;
  PERFORM set_config('app.delete_change_log_source', v_src, true);
  DELETE FROM public.tasks
  WHERE id::text = trim(both from p_task_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_task_with_change_log_source(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_task_with_change_log_source(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.tr_log_assembly_task_delete_change_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p text;
  m text;
  src text;
BEGIN
  p := trim(both from coalesce(OLD.parent, ''));
  m := trim(both from coalesce(OLD.major_item, ''));

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
      project_number,
      machine,
      unit,
      task_text,
      description
    ) VALUES (
      src,
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
