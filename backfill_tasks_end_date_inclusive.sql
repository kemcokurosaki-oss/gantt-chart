-- tasks.end_date を「グリッドの終了日」と同じ包含的な最終日に揃える（start_date + duration 暦日ベース）
-- duration は「開始日を含む稼働日数」とみなし、終了日 = 開始 + (duration - 1) 日
-- ※アプリの gantt.calculateEndDate と休日カレンダーがずれる場合は、編集保存で再計算される想定
--
-- is_detailed = true … 設計工程表専用（全体工程表に出さないタスク）→ 本バックフィルから除外
-- （NULL / false は全体工程表側とリンクしている通常行として更新対象）

UPDATE tasks
SET end_date = (start_date::date + (COALESCE(duration, 1) - 1) * interval '1 day')::date
WHERE start_date IS NOT NULL
  AND COALESCE(duration, 1) >= 1
  AND COALESCE(is_detailed, false) = false;
