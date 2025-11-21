import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import type { KeyboardButton, Screen } from "@/types/telegram";

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

  useEffect(() => {
    setEditedButton(button);
    setActionType(button.url ? "url" : button.linked_screen_id ? "link" : "callback");
  }, [button]);

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
  };

  const handleSave = () => {
    // 验证链接模版是否已选择
    if (actionType === "link" && !editedButton.linked_screen_id) {
      alert("请选择要链接的模版！");
      return;
    }
    
    // 验证 URL 是否已填写
    if (actionType === "url" && !editedButton.url) {
      alert("请填写 URL 链接！");
      return;
    }
    
    // 确保所有按钮都有有效的 callback_data
    let callbackData = editedButton.callback_data;
    
    if (actionType === "link" && editedButton.linked_screen_id) {
      callbackData = `goto_screen_${editedButton.linked_screen_id}`;
    } else if (actionType === "callback") {
      callbackData = editedButton.callback_data || `btn_${Date.now()}`;
    }
    
    const updated: KeyboardButton = {
      id: editedButton.id,
      text: editedButton.text,
      url: actionType === "url" ? editedButton.url : undefined,
      callback_data: actionType !== "url" ? callbackData : undefined,
      linked_screen_id: actionType === "link" ? editedButton.linked_screen_id : undefined,
    };
    
    console.log('Saving button:', updated);
    onSave(updated);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
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
            />
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
                placeholder="button_action"
                value={editedButton.callback_data || ""}
                onChange={(e) => setEditedButton({ ...editedButton, callback_data: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                用于识别按钮点击的数据，会发送给机器人
              </p>
            </TabsContent>
            
            <TabsContent value="url" className="space-y-2">
              <Label htmlFor="url">URL</Label>
              <Input
                id="url"
                placeholder="https://example.com"
                value={editedButton.url || ""}
                onChange={(e) => setEditedButton({ ...editedButton, url: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                点击按钮将打开此链接
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
