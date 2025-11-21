import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import MessageBubble from "@/components/MessageBubble";
import InlineKeyboard from "@/components/InlineKeyboard";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { KeyboardRow, Screen } from "@/types/telegram";
import type { Json } from "@/integrations/supabase/types";
import type { User } from "@supabase/supabase-js";

type ScreenRow = Omit<Screen, "keyboard"> & { keyboard: unknown };

const cloneKeyboard = (rows: KeyboardRow[]): KeyboardRow[] =>
  rows.map((row) => ({
    ...row,
    buttons: row.buttons.map((button) => ({ ...button })),
  }));

const ensureKeyboard = (value: unknown): KeyboardRow[] => {
  if (Array.isArray(value)) {
    return cloneKeyboard(value as KeyboardRow[]);
  }
  return [];
};

const Share = () => {
  const { token } = useParams();
  const navigate = useNavigate();
  const [screen, setScreen] = useState<Screen | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);

  const formatDateTime = (input?: string | null) => {
    if (!input) return "时间未知";
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) return "时间未知";
    return date.toLocaleString();
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const fetchScreen = async () => {
      try {
        const { data, error } = await supabase
          .from("screens")
          .select("id,name,message_content,keyboard,share_token,is_public,updated_at,created_at,user_id")
          .eq("share_token", token)
          .eq("is_public", true)
          .single();

        if (error) throw error;
        if (data) {
          const row = data as ScreenRow;
          setScreen({
            ...row,
            keyboard: ensureKeyboard(row.keyboard),
          });
        } else {
          setScreen(null);
        }
      } catch (error) {
        toast.error("模版未找到");
        navigate("/");
      } finally {
        setIsLoading(false);
      }
    };

    if (token) {
      fetchScreen();
    }
  }, [token, navigate]);

  const handleCopy = async () => {
    if (!user) {
      toast.error("请先登录以复制此模版");
      navigate("/auth");
      return;
    }

    if (!screen) return;

    try {
      const { error } = await supabase
        .from("screens")
        .insert([{
          user_id: user.id,
          name: `${screen.name} (副本)`,
          message_content: screen.message_content,
          keyboard: screen.keyboard as unknown as Json,
          is_public: false,
          share_token: null,
        }]);

      if (error) throw error;
      toast.success("模版已复制到您的账户！");
      navigate("/");
    } catch (error) {
      toast.error("复制模版失败");
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p>加载中...</p>
      </div>
    );
  }

  if (!screen) return null;

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-md mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">{screen.name}</h1>
          <Button onClick={handleCopy}>复制并编辑</Button>
        </div>
        <div className="bg-muted/50 rounded-lg p-3 text-sm text-muted-foreground space-y-1">
          <div>作者: {screen.user_id ? `${screen.user_id.slice(0, 8)}…` : "匿名用户"}</div>
          <div>更新于: {formatDateTime(screen.updated_at || screen.created_at)}</div>
          <div>可见性: {screen.is_public ? "公开" : "私有"}</div>
        </div>

        <div className="bg-[#0E1621] rounded-2xl shadow-xl overflow-hidden">
          <div className="bg-[#17212B] px-4 py-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#2AABEE] flex items-center justify-center text-white font-semibold">
              B
            </div>
            <div>
              <div className="text-white font-medium">机器人名称</div>
              <div className="text-[#7C8B96] text-xs">在线</div>
            </div>
          </div>

          <div className="p-4 min-h-[500px]">
            <div className="inline-block max-w-[85%]">
              <MessageBubble content={screen.message_content} readOnly />
              <InlineKeyboard keyboard={screen.keyboard} readOnly />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Share;
