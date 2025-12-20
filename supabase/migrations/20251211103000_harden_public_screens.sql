-- Migration: 20251211103000
-- Harden public share access and prevent sensitive screens from being public.

CREATE OR REPLACE FUNCTION public.screen_contains_sensitive_data(message_content text, keyboard jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    COALESCE(message_content, '') ~* pattern
    OR COALESCE(keyboard::text, '') ~* pattern
  FROM (
    SELECT E'(?:\\b0x[a-fA-F0-9]{40}\\b|\\bT[1-9A-HJ-NP-Za-km-z]{33}\\b|\\b(?:bc1|[13])[a-zA-HJ-NP-Z0-9]{25,39}\\b)' AS pattern
  ) AS patterns;
$$;

-- Ensure existing public screens with sensitive data are private.
UPDATE public.screens
SET is_public = false,
    share_token = NULL
WHERE is_public = true
  AND public.screen_contains_sensitive_data(message_content, keyboard);

ALTER TABLE public.screens
  DROP CONSTRAINT IF EXISTS screens_public_no_sensitive;

ALTER TABLE public.screens
  ADD CONSTRAINT screens_public_no_sensitive
  CHECK (is_public = false OR NOT public.screen_contains_sensitive_data(message_content, keyboard));

-- Guard against legacy public policy lingering in older deployments.
DROP POLICY IF EXISTS "Anyone can view public screens" ON public.screens;

-- Replace public share RPC to omit user_id.
DROP FUNCTION IF EXISTS public.get_public_screen_by_token(text);

CREATE FUNCTION public.get_public_screen_by_token(token text)
RETURNS TABLE (
  id uuid,
  name text,
  message_content text,
  keyboard jsonb,
  is_public boolean,
  share_token text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id,
    s.name,
    s.message_content,
    s.keyboard,
    s.is_public,
    s.share_token,
    s.created_at,
    s.updated_at
  FROM public.screens s
  WHERE s.is_public = true
    AND s.share_token = token
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_public_screen_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_screen_by_token(text) TO anon, authenticated;
