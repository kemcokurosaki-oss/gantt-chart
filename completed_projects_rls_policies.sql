-- completed_projects RLS policies
-- Supabase Dashboard > SQL Editor で実行してください。

ALTER TABLE public.completed_projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read completed_projects" ON public.completed_projects;
CREATE POLICY "Allow public read completed_projects"
    ON public.completed_projects
    FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "Allow editors insert completed_projects" ON public.completed_projects;
CREATE POLICY "Allow editors insert completed_projects"
    ON public.completed_projects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.jwt() ->> 'email' IN (
            'm2-kusakabe@kusakabe.com',
            'e-kurosaki@kusakabe.com',
            's-morimura@kusakabe.com'
        )
    );

DROP POLICY IF EXISTS "Allow editors delete completed_projects" ON public.completed_projects;
CREATE POLICY "Allow editors delete completed_projects"
    ON public.completed_projects
    FOR DELETE
    TO authenticated
    USING (
        auth.jwt() ->> 'email' IN (
            'm2-kusakabe@kusakabe.com',
            'e-kurosaki@kusakabe.com',
            's-morimura@kusakabe.com'
        )
    );
