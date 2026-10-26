-- 外注先用シート：支給品チェックリスト（外注先ごと・加工品／購入品）
--   ・工事企画表（加工品）・購入部品表（購入品）のPDFをAIで読み取って行を作り、納品を行ごとに✓する
--   ・行は外注先シート（gaichu_sheets）ごと。工番は閲覧の判定（gaichu_can_view_pn）に使うので行にも持つ
--   ・閲覧：その工番の外注先用シートを見られる人／作成・編集・✓：体制表の管理者（org_chart_admins）だけ
--   ・✓を付けた人の名前は、付けたときにDB側で社員名簿（profiles）から自動で入れる
--   ・読み込んだPDFは図面と同じ保存場所（gaichu-figures）の「工番/supply/外注先シートID/」に置く（閲覧・登録の制限は図面と同じ）
-- Supabase の SQL Editor で1回だけ実行してください。

begin;

-- 1. 支給品の行
create table public.gaichu_supply_items (
  id bigserial primary key,
  sheet_id bigint not null references public.gaichu_sheets(id) on delete cascade,
  project_number text not null,
  kind text not null check (kind in ('machined', 'purchased')),   -- machined＝加工品（工事企画表）、purchased＝購入品（購入部品表）
  unit_code text,          -- ユニット（ORDER No.。例：RVOF2）
  doc_no text,             -- 元の資料の番号（Doc No.。例：2820RVOF2-C03）
  seq integer,             -- 通番（資料の行の番号）
  drawing_no text,         -- 図面番号・品番（加工品）
  name text not null default '',
  material text,           -- 材質（加工品）
  spec text,               -- 寸法・型式（購入品）
  qty numeric,
  weight_material numeric, -- 単重量 素材（kg・加工品）
  weight_finished numeric, -- 単重量 仕上（kg・加工品）
  plan_code text,          -- 工程計画の記号（A・A1 など・加工品）
  maker text,              -- メーカー（購入品）
  remark text,             -- 備考
  sort_order integer not null default 0,
  checked_on date,         -- 支給日（✓を付けた日）
  checked_by text,         -- ✓を付けた人（自動）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);
create index gaichu_supply_items_sheet on public.gaichu_supply_items (sheet_id, kind, sort_order);

-- 2. 読み込んだPDFの記録
create table public.gaichu_supply_docs (
  id bigserial primary key,
  sheet_id bigint not null references public.gaichu_sheets(id) on delete cascade,
  project_number text not null,
  kind text check (kind in ('machined', 'purchased')),
  doc_no text,
  file_name text,
  file_path text,          -- gaichu-figures の中の場所
  rows_added integer,
  uploaded_at timestamptz not null default now(),
  uploaded_by text
);

-- 3. ✓を付けた人・更新した人を自動で入れる
create or replace function public.gaichu_supply_touch()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare me text;
begin
  select coalesce(nullif(p.name, ''), p.email) into me from profiles p where p.id = auth.uid();
  new.updated_at := now();
  new.updated_by := coalesce(me, new.updated_by);
  if new.checked_on is null then
    new.checked_by := null;
  elsif tg_op = 'INSERT' or old.checked_on is distinct from new.checked_on then
    new.checked_by := coalesce(me, new.checked_by);
  end if;
  return new;
end $$;
create trigger gaichu_supply_items_touch before insert or update on public.gaichu_supply_items
  for each row execute function public.gaichu_supply_touch();

-- 4. 権限（外注先アカウントは不可。閲覧はその工番を見られる人、書き込みは管理者）
alter table public.gaichu_supply_items enable row level security;
alter table public.gaichu_supply_docs enable row level security;

create policy contractor_default_deny on public.gaichu_supply_items as restrictive for all to authenticated using (not is_contractor());
create policy gaichu_supply_items_select on public.gaichu_supply_items for select to authenticated using (gaichu_can_view_pn(project_number));
create policy gaichu_supply_items_write on public.gaichu_supply_items for all to authenticated using (is_org_chart_admin()) with check (is_org_chart_admin());

create policy contractor_default_deny on public.gaichu_supply_docs as restrictive for all to authenticated using (not is_contractor());
create policy gaichu_supply_docs_select on public.gaichu_supply_docs for select to authenticated using (gaichu_can_view_pn(project_number));
create policy gaichu_supply_docs_write on public.gaichu_supply_docs for all to authenticated using (is_org_chart_admin()) with check (is_org_chart_admin());

grant select, insert, update, delete on public.gaichu_supply_items, public.gaichu_supply_docs to authenticated;
grant usage, select on sequence public.gaichu_supply_items_id_seq, public.gaichu_supply_docs_id_seq to authenticated;
revoke all on public.gaichu_supply_items, public.gaichu_supply_docs from anon;

commit;
