-- 社内名簿（staff_directory）に「役職」の欄を追加する
--   体制表のカードで名簿から選ぶと、所属の後ろに役職が入る（例：日下部電機㈱ 取締役 社長）
--   取締役3名の役職（これまで「課」の欄に入れていた社長・常務・専務）をこの欄に移す
-- Supabase の SQL Editor で1回だけ実行してください。

begin;

alter table public.staff_directory add column if not exists title text;
comment on column public.staff_directory.title is '役職（例：社長、課長）。体制表のカードの所属の後ろに表示';

update public.staff_directory
   set title = split_part(department, ' ', 2), department = '取締役', updated_at = now()
 where department in ('取締役 社長', '取締役 常務', '取締役 専務');

commit;
