
-- Migration: 20251016162012
-- Create screens table for storing Telegram bot message screens
CREATE TABLE public.screens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  message_content TEXT NOT NULL,
  keyboard JSONB NOT NULL,
  is_public BOOLEAN DEFAULT false,
  share_token TEXT UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.screens ENABLE ROW LEVEL SECURITY;

-- Users can view their own screens
CREATE POLICY "Users can view own screens"
ON public.screens FOR SELECT
USING (auth.uid() = user_id);

-- Anyone can view public screens
CREATE POLICY "Anyone can view public screens"
ON public.screens FOR SELECT
USING (is_public = true);

-- Users can insert their own screens
CREATE POLICY "Users can insert own screens"
ON public.screens FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can update their own screens
CREATE POLICY "Users can update own screens"
ON public.screens FOR UPDATE
USING (auth.uid() = user_id);

-- Users can delete their own screens
CREATE POLICY "Users can delete own screens"
ON public.screens FOR DELETE
USING (auth.uid() = user_id);

-- Create index for share tokens
CREATE INDEX idx_screens_share_token ON public.screens(share_token) WHERE share_token IS NOT NULL;

-- Create index for user lookups
CREATE INDEX idx_screens_user_id ON public.screens(user_id);

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_screens_updated_at
BEFORE UPDATE ON public.screens
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Migration: 20251016162123
-- Fix security warning by recreating the function with proper search_path
DROP TRIGGER IF EXISTS update_screens_updated_at ON public.screens;
DROP FUNCTION IF EXISTS public.update_updated_at_column() CASCADE;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
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
