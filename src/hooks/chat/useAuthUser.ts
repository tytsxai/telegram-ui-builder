import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export const useAuthUser = () => {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    supabase.auth
      .getUser()
      .then(({ data: { user } }) => {
        setUser(user);
      })
      .catch(() => {
        // In dev/CI we may not have a reachable Supabase instance; avoid unhandled rejections
        // that can trigger Vite's overlay and break the UI.
        setUser(null);
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  return { user, setUser };
};
