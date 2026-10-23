-- 外注先シートに「出荷のしかた」を追加する（外注先ごと）
--   direct：外注先から客先へ直接出荷（工程表の「工場出荷」の日付を出荷日として表示）
--   via   ：外注先から当社へ出荷し、当社から客先へ出荷（「当社への出荷日」として表示）
--   空欄  ：工程表から自動で判定（「工場出荷」タスクの担当が外注で、外注先企業がこの会社か未入力なら direct、それ以外は via）
-- Supabase の SQL Editor で1回だけ実行してください。

alter table public.gaichu_sheets add column if not exists ship_route text check (ship_route in ('direct', 'via'));
comment on column public.gaichu_sheets.ship_route is '出荷のしかた：direct＝外注先から客先へ直接、via＝当社経由、null＝工程表から自動判定';
