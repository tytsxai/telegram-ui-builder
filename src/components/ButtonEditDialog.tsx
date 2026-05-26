import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { KeyboardButton, Screen } from "@/types/telegram";
import { BUTTON_TEXT_MAX, CALLBACK_DATA_MAX_BYTES, CALLBACK_DATA_ERROR_MESSAGE, getByteLength } from "@/lib/validation";
import { toast } from "sonner";
import { buildCallbackData } from "@/lib/callbackHelper";

export type ButtonValidationErrors = { text?: string; callback?: string; url?: string; link?: string };

export const validateButtonFields = (
  button: KeyboardButton,
  actionType: "callback" | "url" | "link"
): ButtonValidationErrors => {
  const nextErrors: ButtonValidationErrors = {};
  const calcBytes = getByteLength;
  const textLength = button.text?.length ?? 0;

  if (!button.text?.trim()) {
    nextErrors.text = "按钮文本不能为空";
  } else if (textLength > BUTTON_TEXT_MAX) {
    nextErrors.text = "按钮文本最多30个字符";
  }

  if (actionType === "url") {
    if (!button.url?.trim()) {
      nextErrors.url = "请填写 URL 链接";
    } else if (!/^https?:\/\//i.test(button.url.trim())) {
      nextErrors.url = "URL 需以 http(s) 开头";
    }
  }

  if (actionType === "link" && !button.linked_screen_id) {
    nextErrors.link = "请选择要链接的模版";
  }

  if (actionType !== "url") {
    const value = button.callback_data ?? "";
    if (!value.trim() && actionType === "callback") {
      nextErrors.callback = "Callback data 不能为空";
    } else if (calcBytes(value) > CALLBACK_DATA_MAX_BYTES) {
      nextErrors.callback = CALLBACK_DATA_ERROR_MESSAGE;
    }
  }

  return nextErrors;
};

interface ButtonEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  button: KeyboardButton;
  onSave: (button: KeyboardButton) => void;
  screens?: Screen[];
  onOpenScreen?: (screenId: string) => void;
  onCreateAndOpenScreen?: () => void;
}

const ButtonEditDialog = ({ open, onOpenChange, button, onSave, screens = [], onOpenScreen, onCreateAndOpenScreen }: ButtonEditDialogProps) => {
  const [editedButton, setEditedButton] = useState(button);
  const [actionType, setActionType] = useState<"callback" | "url" | "link">(
    button.url ? "url" : button.linked_screen_id ? "link" : "callback"
  );
  const [search, setSearch] = useState("");
  const [errors, setErrors] = useState<{ text?: string; callback?: string; url?: string; link?: string }>({});
  const [callbackPrefix, setCallbackPrefix] = useState("btn");
  const [ttlSeconds, setTtlSeconds] = useState<string>("300");
  const [nonceEnabled, setNonceEnabled] = useState(true);

  useEffect(() => {
    setEditedButton(button);
    setActionType(button.url ? "url" : button.linked_screen_id ? "link" : "callback");
    setErrors({});
    setCallbackPrefix("btn");
    setTtlSeconds("300");
    setNonceEnabled(true);
  }, [button]);

  const calcBytes = getByteLength;
  const textLength = editedButton.text?.length ?? 0;
  const callbackBytes = calcBytes(editedButton.callback_data ?? "");
  const callbackError = errors.callback || (actionType === "callback" && callbackBytes > CALLBACK_DATA_MAX_BYTES ? CALLBACK_DATA_ERROR_MESSAGE : undefined);
  const nearLimit = callbackBytes > CALLBACK_DATA_MAX_BYTES - 8;

  // 智能按钮命名：当选择链接模板时，自动添加后缀
  const handleScreenSelect = (screenId: string) => {
    const targetScreen = screens.find(s => s.id === screenId);
    if (!targetScreen) return;

    // 移除旧的后缀（如果存在）
    let baseText = editedButton.text;
    const oldScreen = editedButton.linked_screen_id 
      ? screens.find(s => s.id === editedButton.linked_screen_id)
      : null;
    
    if (oldScreen && baseText.endsWith(` → ${oldScreen.name}`)) {
      baseText = baseText.replace(` → ${oldScreen.name}`, '');
    }

    // 智能截断：确保总长度不超过30字符
    const maxBaseLength = 18; // 为 " → " (3字符) 和模板名留出空间
    const maxScreenNameLength = 9; // 模板名最多9字符
    
    const truncatedBase = baseText.length > maxBaseLength 
      ? baseText.slice(0, maxBaseLength) 
      : baseText;
    
    const truncatedScreenName = targetScreen.name.length > maxScreenNameLength
      ? targetScreen.name.slice(0, maxScreenNameLength)
      : targetScreen.name;
    
    const newText = `${truncatedBase} → ${truncatedScreenName}`;
    
    setEditedButton({ 
      ...editedButton, 
      linked_screen_id: screenId,
      text: newText
    });
    setErrors((prev) => ({ ...prev, link: undefined, text: newText ? undefined : "按钮文本不能为空" }));
  };

  const handleGenerateCallback = () => {
    const ttlValue = Number(ttlSeconds);
    const ttl = Number.isFinite(ttlValue) && ttlValue > 0 ? ttlValue : undefined;
    const actionSlug = (editedButton.text || editedButton.id || "action").toLowerCase().replace(/\s+/g, "_");
    try {
      const { value, bytes } = buildCallbackData({
        prefix: callbackPrefix,
        action: actionSlug || "action",
        data: { id: editedButton.id, text: editedButton.text },
        ttlSeconds: ttl,
        nonce: nonceEnabled,
      });
      setEditedButton({ ...editedButton, callback_data: value });
      setErrors((prev) => ({ ...prev, callback: bytes > CALLBACK_DATA_MAX_BYTES ? CALLBACK_DATA_ERROR_MESSAGE : undefined }));
    } catch (e) {
      console.error(e);
      toast.error("生成回调数据失败");
    }
  };

  const handleSave = () => {
    const newErrors = validateButtonFields(editedButton, actionType);
    setErrors(newErrors);
    const hasError = Object.values(newErrors).some(Boolean);
    if (hasError) {
      // Surface the first error prominently
      const firstError = newErrors.text || newErrors.callback || newErrors.url || newErrors.link;
      toast.error(firstError ?? "请修正高亮字段后再保存");
      return;
    }
    
    // 确保所有按钮都有有效的 callback_data
    let callbackData = editedButton.callback_data;
    
    if (actionType === "link" && editedButton.linked_screen_id) {
      callbackData = `goto_screen_${editedButton.linked_screen_id}`;
    } else if (actionType === "callback") {
      // If provided callback exceeds limit, hard-block save with error
      const bytes = getByteLength(editedButton.callback_data || "");
      if (!editedButton.callback_data || bytes > CALLBACK_DATA_MAX_BYTES) {
        setErrors((prev) => ({ ...prev, callback: CALLBACK_DATA_ERROR_MESSAGE }));
        toast.error(CALLBACK_DATA_ERROR_MESSAGE);
        return;
      }
      callbackData = editedButton.callback_data;
    }

    const updated: KeyboardButton = {
      id: editedButton.id,
      text: editedButton.text,
      url: actionType === "url" ? editedButton.url : undefined,
      callback_data: actionType !== "url" ? callbackData : undefined,
      linked_screen_id: actionType === "link" ? editedButton.linked_screen_id : undefined,
    };
    
    onSave(updated);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]" aria-label="编辑按钮对话框" aria-modal="true" role="dialog">
        <DialogHeader>
          <DialogTitle>编辑按钮</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="text">按钮文本</Label>
            <Input
              id="text"
              value={editedButton.text}
              onChange={(e) => setEditedButton({ ...editedButton, text: e.target.value })}
              maxLength={30}
              className={errors.text ? "border-destructive" : undefined}
            />
            <div className="flex items-center justify-between text-xs">
              <span className={errors.text ? "text-destructive" : "text-muted-foreground"}>
                {errors.text ?? `最长 ${BUTTON_TEXT_MAX} 个字符，推荐简短可读`}
              </span>
              <span className="text-muted-foreground">{textLength}/{BUTTON_TEXT_MAX}</span>
            </div>
          </div>
          
          <Tabs value={actionType} onValueChange={(v) => setActionType(v as "callback" | "url" | "link")}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="callback">回调数据</TabsTrigger>
              <TabsTrigger value="url">URL链接</TabsTrigger>
              <TabsTrigger value="link">链接模版</TabsTrigger>
            </TabsList>
            
            <TabsContent value="callback" className="space-y-2">
              <Label htmlFor="callback_data">Callback Data</Label>
              <Input
                id="callback_data"
                aria-label="Callback Data"
                placeholder="button_action"
                value={editedButton.callback_data || ""}
                onChange={(e) => setEditedButton({ ...editedButton, callback_data: e.target.value })}
                className={callbackError ? "border-destructive" : undefined}
              />
              <div className="flex items-center justify-between text-xs">
                <span className={callbackError ? "text-destructive" : "text-muted-foreground"}>
                  {callbackError ?? "用于识别按钮点击的数据，会发送给机器人"}
                </span>
                <span className={callbackError ? "text-destructive" : nearLimit ? "text-amber-600" : "text-muted-foreground"}>
                  {callbackBytes}/{CALLBACK_DATA_MAX_BYTES}B{nearLimit ? " · 接近上限" : ""}
                </span>
              </div>
              <div className="rounded-md border bg-muted/30 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-foreground">回调助手</div>
                  <span className="text-[11px] text-muted-foreground">TTL/nonce 控制，自动截断</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="cb-prefix">命名空间/前缀</Label>
                    <Input
                      id="cb-prefix"
                      value={callbackPrefix}
                      onChange={(e) => setCallbackPrefix(e.target.value)}
                      placeholder="btn"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="cb-ttl">TTL (秒，可选)</Label>
                    <Input
                      id="cb-ttl"
                      type="number"
                      min="0"
                      value={ttlSeconds}
                      onChange={(e) => setTtlSeconds(e.target.value)}
                      placeholder="300"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Switch
                      id="cb-nonce"
                      checked={nonceEnabled}
                      onCheckedChange={(val) => setNonceEnabled(val)}
                    />
                    <Label htmlFor="cb-nonce">包含 nonce 防重放</Label>
                  </div>
                  {nearLimit && <span className="text-xs text-amber-600">已接近 64B 限制</span>}
                </div>
                <Button variant="secondary" size="sm" onClick={handleGenerateCallback}>
                  智能生成 callback_data
                </Button>
              </div>
            </TabsContent>
            
            <TabsContent value="url" className="space-y-2">
              <Label htmlFor="url">URL</Label>
              <Input
                id="url"
                placeholder="https://example.com"
                value={editedButton.url || ""}
                onChange={(e) => setEditedButton({ ...editedButton, url: e.target.value })}
                className={errors.url ? "border-destructive" : undefined}
              />
              <p className={`text-xs ${errors.url ? "text-destructive" : "text-muted-foreground"}`}>
                {errors.url ?? "点击按钮将打开此链接"}
              </p>
            </TabsContent>
            
            <TabsContent value="link" className="space-y-2">
              <Label htmlFor="linked_screen">链接到模版</Label>
              {screens.length === 0 ? (
                <div className="p-4 border border-dashed rounded-md text-center">
                  <p className="text-sm text-muted-foreground mb-2">
                    还没有可用的模版
                  </p>
                  <p className="text-xs text-muted-foreground">
                    💡 提示：先保存当前模版，然后创建新模版作为跳转目标
                  </p>
                </div>
              ) : (
                <>
                  <Input
                    placeholder="搜索模版名称"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <Select
                    value={editedButton.linked_screen_id || ""}
                    onValueChange={handleScreenSelect}
                    disabled={screens.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择要链接的模版" />
                    </SelectTrigger>
                    <SelectContent>
                      {screens
                        .filter((s) =>
                          search.trim() === ""
                            ? true
                            : s.name.toLowerCase().includes(search.trim().toLowerCase())
                        )
                        .map((screen) => (
                        <SelectItem key={screen.id} value={screen.id}>
                          {screen.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.link && <p className="text-xs text-destructive">{errors.link}</p>}
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      disabled={!editedButton.linked_screen_id}
                      onClick={() => {
                        if (editedButton.linked_screen_id && onOpenScreen) {
                          onOpenScreen(editedButton.linked_screen_id);
                          onOpenChange(false);
                        }
                      }}
                    >
                      打开目标
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        onCreateAndOpenScreen?.();
                        onOpenChange(false);
                      }}
                    >
                      新建并跳转
                    </Button>
                  </div>
                   <p className="text-xs text-muted-foreground">
                     💡 按钮文本会自动添加 "→ 模版名" 后缀，方便识别层级关系
                   </p>
                </>
              )}
            </TabsContent>
          </Tabs>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ButtonEditDialog;
