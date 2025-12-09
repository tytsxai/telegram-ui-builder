import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Circle, MousePointerClick, Sparkles, Share2 } from "lucide-react";

type OnboardingProgress = {
  template: boolean;
  preview: boolean;
  share: boolean;
};

interface OnboardingGuideProps {
  visible: boolean;
  progress: OnboardingProgress;
  onDismiss: () => void;
  onOpenTemplate: () => void;
  onTogglePreview: () => void;
  onShare: () => void;
}

export const OnboardingGuide = ({
  visible,
  progress,
  onDismiss,
  onOpenTemplate,
  onTogglePreview,
  onShare,
}: OnboardingGuideProps) => {
  const skipButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (visible) {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
      requestAnimationFrame(() => {
        // Prefer focusing the primary CTA (open template) if present, otherwise the skip button.
        const primary = cardRef.current?.querySelector<HTMLButtonElement>("[data-onboarding-primary]");
        (primary ?? skipButtonRef.current)?.focus();
      });
    }
  }, [visible]);

  const handleDismiss = () => {
    onDismiss();
    // restore focus to the element that was focused before the overlay opened, or fall back to body
    const target = previousFocusRef.current || document.body;
    requestAnimationFrame(() => target?.focus?.());
  };

  if (!visible) return null;

  const steps = [
    {
      key: "template",
      title: "1. 选择模板",
      desc: "打开模板库，载入一个起点避免空白页。",
      actionLabel: "打开模板库",
      onAction: onOpenTemplate,
      icon: <Sparkles className="w-4 h-4" />,
    },
    {
      key: "preview",
      title: "2. 编辑 / 预览",
      desc: "在画布编辑消息并切到预览，确认跳转逻辑。",
      actionLabel: "切换预览",
      onAction: onTogglePreview,
      icon: <MousePointerClick className="w-4 h-4" />,
    },
    {
      key: "share",
      title: "3. 分享 / 复制",
      desc: "复制 JSON 或生成分享链接给同事验证。",
      actionLabel: "复制 JSON",
      onAction: onShare,
      icon: <Share2 className="w-4 h-4" />,
    },
  ] as const;

  const doneCount = [progress.template, progress.preview, progress.share].filter(Boolean).length;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[min(960px,92vw)] px-3 sm:px-0 pointer-events-none">
      <Card
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label="一次性引导"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            handleDismiss();
          }
        }}
        className="pointer-events-auto bg-gradient-to-r from-slate-900 via-slate-900/90 to-slate-950 text-white border border-white/10 shadow-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
      >
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 md:gap-4 p-4 md:p-5">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="bg-emerald-500/20 text-emerald-200 border-emerald-500/40">
                首次引导
              </Badge>
              <span className="text-sm text-slate-300">3 步跑通编辑 · 预览 · 分享</span>
            </div>
            <div className="flex items-center gap-3">
              <h3 className="text-lg font-semibold">内置模板 & 一次性引导</h3>
              <Progress value={(doneCount / 3) * 100} className="w-32 bg-white/10" />
              <span className="text-xs text-slate-300">{doneCount}/3 完成</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              ref={skipButtonRef}
              variant="ghost"
              size="sm"
              className="text-slate-200 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
              aria-label="跳过引导"
              onClick={handleDismiss}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleDismiss();
                }
              }}
            >
              跳过引导
            </Button>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-3 p-4 md:p-5 pt-0">
          {steps.map((step) => {
            const isDone = progress[step.key as keyof OnboardingProgress];
            return (
              <div
                key={step.key}
                className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-3 flex flex-col gap-2 min-h-[140px]"
              >
                <div className="flex items-center justify-between text-sm font-semibold">
                  <div className="flex items-center gap-2">
                    {step.icon}
                    <span>{step.title}</span>
                  </div>
                  {isDone ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Circle className="w-4 h-4 text-white/60" />
                  )}
                </div>
                <p className="text-sm text-slate-200/80 leading-relaxed">{step.desc}</p>
                <Button
                  data-onboarding-primary={step.key === "template"}
                  variant={isDone ? "secondary" : "default"}
                  size="sm"
                  className="justify-start focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
                  onClick={step.onAction}
                >
                  {step.actionLabel}
                </Button>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
};

export default OnboardingGuide;
