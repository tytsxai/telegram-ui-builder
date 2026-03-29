-- Ensure updated rows still belong to the authenticated user after UPDATE.
DROP POLICY IF EXISTS "Users can update own screens" ON public.screens;

CREATE POLICY "Users can update own screens"
ON public.screens FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
