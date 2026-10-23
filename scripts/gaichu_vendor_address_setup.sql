-- 外注先マスタに「住所」を追加する
--   外注先マスタの管理画面で入力し、外注先用シートの概要の「外注先企業」カードに正式社名と一緒に表示する
-- Supabase の SQL Editor で1回だけ実行してください。

alter table public.gaichu_vendors add column if not exists address text;
comment on column public.gaichu_vendors.address is '住所（外注先用シートの概要の外注先企業カードに表示）';
