-- 外注先用シート：組図配布チェックリストの支給日（管理者だけが使う機能）
-- 行は工程表（tasks）の設計の詳細タスク。外注先ごとに支給日を1つ持つ（支給日が入っていれば配布済み）
-- 閲覧・変更とも体制表の管理者（org_chart_admins）のみ。タスクが削除されたら支給日も消える
-- Supabase の SQL Editor で1回だけ実行してください。

create table public.gaichu_drawing_dist (
  task_id bigint not null references public.tasks(id) on delete cascade,
  vendor_id bigint not null,
  project_number text not null,
  supplied_on date not null,
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (task_id, vendor_id)
);
create index gaichu_drawing_dist_pn on public.gaichu_drawing_dist (project_number);
comment on table public.gaichu_drawing_dist is '組図配布チェックリスト：設計の組立図（tasks の is_detailed 行）を外注先（gaichu_vendors.id）に配布した日。行がない＝未配布。';

alter table public.gaichu_drawing_dist enable row level security;
create policy contractor_default_deny on public.gaichu_drawing_dist as restrictive for all to authenticated using (not is_contractor());
create policy gaichu_drawing_dist_admin on public.gaichu_drawing_dist for all to authenticated using (is_org_chart_admin()) with check (is_org_chart_admin());
