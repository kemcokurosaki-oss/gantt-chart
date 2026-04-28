-- Supabase Realtime の postgres_changes で、DELETE 時の payload.old に
-- 主キー以外の列も含めたい場合に実行してください（DEFAULT だと id のみのことが多い）。
-- ストレージ・WAL がやや増えます。不要なら実行しなくて構いません。
--
-- 全体工程表の gantt-app.js は、DELETE 時に window.allTasks / gantt から行を補完する
-- フォールバックもあるため、タブを開いた状態での削除は多くの場合ログに残ります。

ALTER TABLE public.tasks REPLICA IDENTITY FULL;
