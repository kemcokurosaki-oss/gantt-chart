-- 外注先向け工事詳細シート：体制表（指揮系統）の編集機能用テーブル
-- Supabase の SQL Editor で1回だけ実行してください。

-- 体制表・社内名簿を編集できる管理者
create table public.org_chart_admins (
  email text primary key,
  created_at timestamptz not null default now()
);
comment on table public.org_chart_admins is '外注先向け体制表・社内名簿を編集できる管理者のメールアドレス';
alter table public.org_chart_admins enable row level security;
create policy org_chart_admins_select on public.org_chart_admins for select to authenticated using (true);

create or replace function public.is_org_chart_admin()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from org_chart_admins where lower(email) = lower(auth.jwt() ->> 'email'));
$$;

-- 管理者を追加するときはこの行と同じ形で insert する
insert into public.org_chart_admins(email) values ('e-kurosaki@kusakabe.com'), ('s-morimura@kusakabe.com');

-- 社内名簿（体制表のプルダウン用）。電話番号を含むため閲覧は社内ログイン者のみ
create table public.staff_directory (
  id bigserial primary key,
  name text not null,
  company text not null default '日下部電機㈱',
  department text,
  tel text,
  sort_order integer not null default 0,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
comment on table public.staff_directory is '体制表で選択する社内の人のプロフィール（氏名・所属・電話）。閲覧は社内ログイン者、編集は org_chart_admins のみ。';
alter table public.staff_directory enable row level security;
create policy contractor_default_deny on public.staff_directory as restrictive for all to authenticated using (not is_contractor());
create policy staff_directory_select on public.staff_directory for select to authenticated using (true);
create policy staff_directory_write on public.staff_directory for all to authenticated using (is_org_chart_admin()) with check (is_org_chart_admin());

-- 体制表（工番ごと・系統ごと）。外注先も閲覧するため anon で読み取り可
create table public.org_charts (
  id bigserial primary key,
  project_number text not null,
  title text not null,
  sort_order integer not null default 0,
  tree jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text
);
comment on table public.org_charts is '外注先向け工事詳細シートの体制表。tree は節点の配列（type=person|label, children で枝分け）。人物情報は選択時点の値を複製して保持。';
create index org_charts_project_idx on public.org_charts(project_number, sort_order);
alter table public.org_charts enable row level security;
create policy org_charts_select on public.org_charts for select to anon, authenticated using (true);
create policy org_charts_insert on public.org_charts for insert to authenticated with check (is_org_chart_admin());
create policy org_charts_update on public.org_charts for update to authenticated using (is_org_chart_admin()) with check (is_org_chart_admin());
create policy org_charts_delete on public.org_charts for delete to authenticated using (is_org_chart_admin());

-- 2816 の現行体制表を初期データとして登録
insert into public.org_charts(project_number, title, sort_order, tree) values
('2816', '試運転指揮系統', 0, '[
 {"type":"person","role":"試運転責任者","roleAlt":false,"org":"日下部電機㈱ 操業部","name":"三浦 雅樹","tel":"090-8056-8988","children":[
   {"type":"person","role":"全般","roleAlt":true,"org":"日下部電機㈱","name":"日下部 光正","tel":"090-8056-9219","subName":"廣瀬 厚生","subTel":"080-5674-4158","children":[]},
   {"type":"person","role":"組立業者 責任者（及び助勢）","roleAlt":false,"org":"シマブンエンジニアリング株式会社","name":"岸田 嘉彦","tel":"080-5704-9982","children":[
     {"type":"label","text":"岸田氏 不在時","children":[
       {"type":"person","role":"組立業者 助勢","roleAlt":true,"org":"シマブンエンジニアリング株式会社","name":"シマブン現場作業員","tel":"079-435-7233","children":[]},
       {"type":"person","role":"電気業者","roleAlt":true,"org":"三宝電機株式会社","name":"古川 康樹","tel":"090-7356-0209","children":[]}
     ]}
   ]}
 ]}
]'::jsonb),
('2816', '組立発注担当系統', 1, '[
 {"type":"person","role":"組立発注担当者","roleAlt":false,"org":"日下部電機㈱ 製造管理部","name":"森村 象平","tel":"090-8056-9219","children":[
   {"type":"person","role":"機械","roleAlt":true,"org":"日下部電機㈱","name":"長谷川 亮介","tel":"090-9701-6918","children":[]},
   {"type":"person","role":"電気","roleAlt":true,"org":"日下部電機㈱","name":"木村 至","tel":"090-9701-6820","children":[]}
 ]}
]'::jsonb);
