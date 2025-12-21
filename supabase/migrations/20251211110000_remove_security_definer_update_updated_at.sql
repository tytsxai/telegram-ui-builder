-- Migration: 20251211110000
-- Remove SECURITY DEFINER from update_updated_at_column to avoid RLS bypass.

DROP TRIGGER IF EXISTS update_screens_updated_at ON public.screens;
DROP FUNCTION IF EXISTS public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_screens_updated_at
BEFORE UPDATE ON public.screens
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
