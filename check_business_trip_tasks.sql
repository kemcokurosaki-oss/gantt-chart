-- ============================================================
-- 出張タスク調査クエリ
-- ============================================================

-- 1. is_business_trip=true の全タスク一覧
--    （工程表と出張予定シートの両方に出るタスクを特定）
SELECT
    id,
    project_number,
    text,
    owner,
    start_date,
    is_business_trip,
    task_type,
    parent,
    machine,
    unit,
    created_at
FROM tasks
WHERE is_business_trip = true
ORDER BY project_number, created_at;

-- ============================================================

-- 2. 重複タスク確認（同じ工事番号＋タスク名が複数存在するか）
SELECT
    project_number,
    text,
    COUNT(*) AS count,
    array_agg(id ORDER BY id) AS ids,
    array_agg(is_business_trip ORDER BY id) AS is_business_trip_values,
    array_agg(task_type ORDER BY id) AS task_types
FROM tasks
WHERE is_business_trip = true
GROUP BY project_number, text
HAVING COUNT(*) > 1
ORDER BY project_number, text;

-- ============================================================

-- 3. 工程表にも出張シートにも表示されるタスクの原因調査
--    is_business_trip=true なのに task_type が設定されているケース
SELECT
    id,
    project_number,
    text,
    is_business_trip,
    task_type,
    parent,
    created_at
FROM tasks
WHERE is_business_trip = true
  AND task_type IS NOT NULL
ORDER BY project_number;

-- ============================================================

-- 4. 完了済み工事番号の出張タスク確認
--    completed_projects に登録されている工事番号の出張タスク
SELECT
    t.id,
    t.project_number,
    t.text,
    t.is_business_trip,
    t.task_type,
    t.start_date,
    t.created_at,
    cp.project_number AS in_completed_projects,
    cp.customer_name,
    cp.project_details
FROM tasks t
JOIN completed_projects cp ON cp.project_number = t.project_number::text
WHERE t.is_business_trip = true
ORDER BY t.project_number, t.created_at;

-- ============================================================

-- 5. 特定タスクのis_business_trip状態を確認（工番を入れて実行）
-- ※ 両方に表示されているタスクの工番に変えて実行してください
-- SELECT id, project_number, text, is_business_trip, task_type, parent
-- FROM tasks
-- WHERE project_number = '対象の工番をここに入力'
-- ORDER BY id;
