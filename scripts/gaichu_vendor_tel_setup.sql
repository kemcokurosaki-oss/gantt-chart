-- 外注先マスタに「代表電話番号」を追加する（会社の代表番号。担当者の電話は gaichu_vendor_contacts.tel）
--   担当者のメールアドレスは gaichu_vendor_contacts.email（列は作成済み）を使う
-- Supabase の SQL Editor で1回だけ実行してください。

alter table public.gaichu_vendors add column if not exists tel text;
comment on column public.gaichu_vendors.tel is '会社の代表電話番号';
