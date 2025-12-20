-- Migration: 20251210090000
-- Restrict public screen access to token-based RPC and remove broad public SELECT.

DROP POLICY IF EXISTS "Anyone can view public screens" ON public.screens;

CREATE OR REPLACE FUNCTION public.get_public_screen_by_token(token text)
RETURNS public.screens
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.screens
  WHERE is_public = true
    AND share_token = token
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_public_screen_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_screen_by_token(text) TO anon, authenticated;
