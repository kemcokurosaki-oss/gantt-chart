-- =============================================================================
-- 組立全体の task_locations を元に、同一工事番号・機械の「他見出し」タスクへ場所を一括コピー
-- （Supabase の SQL Editor で一度だけ実行する想定）
--
-- 参照元: tasks.parent = '組立全体' かつ task_locations に1行以上ある (area_group/area_number)
-- 反映先: parent が 外観検査 / 試運転 / 客先立会 / 出荷確認会議 / 出荷
--         かつ task_locations がまだ0件のタスクのみ（既存の場所は上書きしない）
--
-- その後、tasks.area_group / tasks.area_number を task_locations の内容に合わせて更新
-- （アプリの persistTaskLocations と同じ集約ルール）
--
-- 実行前にバックアップまたはトランザクションで確認することを推奨します。
-- task_locations.task_id と tasks.id の型が一致しない場合は JOIN のキャストを調整してください。
-- =============================================================================

BEGIN;

WITH kumitate AS (
  SELECT
    t.id,
    TRIM(BOTH FROM COALESCE(t.project_number::text, '')) AS pn,
    TRIM(BOTH FROM COALESCE(t.machine::text, '')) AS mc
  FROM tasks t
  WHERE t.parent = '組立全体'
    AND TRIM(BOTH FROM COALESCE(t.project_number::text, '')) <> ''
    AND TRIM(BOTH FROM COALESCE(t.machine::text, '')) <> ''
    AND COALESCE(t.is_business_trip, false) = false
    AND COALESCE(t.task_type, '') <> 'business_trip'
),
source_loc AS (
  SELECT DISTINCT
    k.pn,
    k.mc,
    TRIM(BOTH FROM COALESCE(tl.area_group::text, '')) AS area_group,
    TRIM(BOTH FROM COALESCE(tl.area_number::text, '')) AS area_number
  FROM task_locations tl
  INNER JOIN kumitate k ON tl.task_id = k.id
  WHERE TRIM(BOTH FROM COALESCE(tl.area_group::text, '')) <> ''
    AND TRIM(BOTH FROM COALESCE(tl.area_number::text, '')) <> ''
),
targets AS (
  SELECT
    t.id,
    TRIM(BOTH FROM COALESCE(t.project_number::text, '')) AS pn,
    TRIM(BOTH FROM COALESCE(t.machine::text, '')) AS mc
  FROM tasks t
  WHERE t.parent IN ('外観検査', '試運転', '客先立会', '出荷確認会議', '出荷')
    AND TRIM(BOTH FROM COALESCE(t.project_number::text, '')) <> ''
    AND TRIM(BOTH FROM COALESCE(t.machine::text, '')) <> ''
    AND COALESCE(t.is_business_trip, false) = false
    AND COALESCE(t.task_type, '') <> 'business_trip'
    AND NOT EXISTS (SELECT 1 FROM task_locations x WHERE x.task_id = t.id)
    AND EXISTS (
      SELECT 1
      FROM source_loc s
      WHERE s.pn = TRIM(BOTH FROM COALESCE(t.project_number::text, ''))
        AND s.mc = TRIM(BOTH FROM COALESCE(t.machine::text, ''))
    )
),
ins AS (
  INSERT INTO task_locations (task_id, area_group, area_number)
  SELECT tg.id, sl.area_group, sl.area_number
  FROM targets tg
  INNER JOIN source_loc sl ON sl.pn = tg.pn AND sl.mc = tg.mc
  RETURNING task_id
),
affected AS (
  SELECT DISTINCT task_id FROM ins
),
agg AS (
  SELECT
    tl.task_id,
    CASE
      WHEN COUNT(DISTINCT tl.area_group) = 1 THEN MAX(tl.area_group::text)
      ELSE ''
    END AS area_g,
    CASE
      WHEN COUNT(DISTINCT tl.area_group) = 1 THEN
        string_agg(tl.area_number::text, ',' ORDER BY tl.area_number::text)
      ELSE
        string_agg(
          tl.area_group::text || '-' || tl.area_number::text,
          ',' ORDER BY tl.area_group::text, tl.area_number::text
        )
    END AS area_n
  FROM task_locations tl
  INNER JOIN affected a ON tl.task_id = a.task_id
  GROUP BY tl.task_id
)
UPDATE tasks t
SET
  area_group = agg.area_g,
  area_number = agg.area_n
FROM agg
WHERE t.id = agg.task_id;

COMMIT;

-- =============================================================================
-- 確認用（実行前にコメントを外して件数だけ見る）
-- =============================================================================
-- WITH kumitate AS (
--   SELECT t.id,
--     TRIM(BOTH FROM COALESCE(t.project_number::text, '')) AS pn,
--     TRIM(BOTH FROM COALESCE(t.machine::text, '')) AS mc
--   FROM tasks t
--   WHERE t.parent = '組立全体'
--     AND TRIM(BOTH FROM COALESCE(t.project_number::text, '')) <> ''
--     AND TRIM(BOTH FROM COALESCE(t.machine::text, '')) <> ''
--     AND COALESCE(t.is_business_trip, false) = false
--     AND COALESCE(t.task_type, '') <> 'business_trip'
-- ),
-- source_loc AS (
--   SELECT DISTINCT k.pn, k.mc, tl.area_group, tl.area_number
--   FROM task_locations tl
--   INNER JOIN kumitate k ON tl.task_id = k.id
-- )
-- SELECT COUNT(*) AS source_pair_rows FROM source_loc;
