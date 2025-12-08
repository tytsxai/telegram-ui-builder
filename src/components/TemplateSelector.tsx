import { useEffect, useMemo, useState } from "react";
import type { TemplateDefinition, TemplateMeta, TemplatePayload } from "@/types/templates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Card } from "@/components/ui/card";
import { Sparkles, Clock3, ShieldCheck, RefreshCcw, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface TemplateSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (template: TemplateDefinition) => void;
}

const baseAccent = "from-slate-800 via-slate-900 to-slate-950";

export const TemplateSelector = ({ open, onOpenChange, onApply }: TemplateSelectorProps) => {
  const [library, setLibrary] = useState<TemplateMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || library.length > 0) return;
    const load = async () => {
      try {
        setError(null);
        const res = await fetch("/templates/library.json");
        if (!res.ok) throw new Error("无法加载模板列表");
        const data = (await res.json()) as TemplateMeta[];
        setLibrary(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "模板列表加载失败");
      }
    };
    void load();
  }, [open, library.length]);

  const handleReload = async () => {
    setLibrary([]);
    setError(null);
    if (open) {
      try {
        const res = await fetch("/templates/library.json");
        if (res.ok) {
          const data = (await res.json()) as TemplateMeta[];
          setLibrary(data);
        } else {
          setError("刷新失败，请稍后重试");
        }
      } catch (e) {
        setError("刷新失败，请检查网络");
      }
    }
  };

  const cards = useMemo(() => library, [library]);

  const handleApply = async (meta: TemplateMeta) => {
    try {
      setError(null);
      setLoadingId(meta.id);
      const res = await fetch(meta.file);
      if (!res.ok) throw new Error("模板文件获取失败");
      const payload = (await res.json()) as TemplatePayload;
      onApply({ ...meta, ...payload });
    } catch (e) {
      setError(e instanceof Error ? e.message : "载入模板失败");
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-xl">
        <SheetHeader className="space-y-2">
          <SheetTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="w-4 h-4 text-primary" /> 模板库
          </SheetTitle>
          <SheetDescription className="text-sm text-muted-foreground">
            选一个起点，自动通过校验并带上快捷入口。加载后可直接预览和保存。
          </SheetDescription>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-1 rounded-full bg-emerald-500/10 text-emerald-600 px-2 py-1 border border-emerald-500/30">
              <ShieldCheck className="w-3 h-3" /> 已开启格式校验
            </div>
            <div className="flex items-center gap-1 rounded-full bg-muted px-2 py-1">
              <Clock3 className="w-3 h-3" /> 选用后 60s 内可跑通流程
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleReload} title="刷新模板列表">
              <RefreshCcw className="w-4 h-4" />
            </Button>
          </div>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-140px)] mt-4 pr-3">
          <div className="space-y-3">
            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-sm px-3 py-2">
                {error}
              </div>
            )}

            {cards.map((template) => (
              <Card
                key={template.id}
                className="p-4 border border-border/60 bg-gradient-to-r shadow-md relative overflow-hidden"
              >
                <div
                  className={cn(
                    "absolute inset-0 opacity-60 blur-3xl pointer-events-none bg-gradient-to-r",
                    template.accent || baseAccent
                  )}
                />
                <div className="relative space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="bg-background/70 border-white/10 text-xs">
                          {template.category || "通用"}
                        </Badge>
                        {template.estimated_time && (
                          <Badge variant="secondary" className="text-xs">
                            {template.estimated_time} 上手
                          </Badge>
                        )}
                      </div>
                      <h3 className="font-semibold text-base">{template.name}</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {template.summary}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <Button
                        size="sm"
                        onClick={() => void handleApply(template)}
                        disabled={loadingId === template.id}
                        className="shadow-sm"
                      >
                        {loadingId === template.id ? "加载中..." : "载入模板"}
                      </Button>
                      {template.tags && (
                        <div className="flex flex-wrap justify-end gap-1">
                          {template.tags.map((tag) => (
                            <Badge key={tag} variant="outline" className="text-[10px]">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {template.preview && (
                    <div className="rounded-lg border border-white/10 bg-background/70 p-3 text-xs space-y-1 shadow-inner">
                      <div className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                        <Check className="w-3 h-3 text-primary" /> 预览
                      </div>
                      <p className="text-foreground/90 leading-relaxed">{template.preview}</p>
                    </div>
                  )}
                </div>
              </Card>
            ))}

            {!cards.length && !error && (
              <Card className="p-4 bg-muted/60 border-dashed">
                <p className="text-sm text-muted-foreground">模板加载中，请稍候…</p>
              </Card>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
};

export default TemplateSelector;
