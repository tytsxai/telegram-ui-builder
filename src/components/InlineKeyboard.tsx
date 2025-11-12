import { useEffect, useState } from "react";
import { X, Settings } from "lucide-react";
import type { KeyboardRow, KeyboardButton } from "./TelegramChat";
import ButtonEditDialog from "./ButtonEditDialog";

interface Screen {
  id: string;
  name: string;
}

interface InlineKeyboardProps {
  keyboard: KeyboardRow[];
  onButtonTextChange?: (rowId: string, buttonId: string, newText: string) => void;
  onButtonUpdate?: (rowId: string, buttonId: string, button: KeyboardButton) => void;
  onDeleteButton?: (rowId: string, buttonId: string) => void;
  onButtonClick?: (button: KeyboardButton) => void;
  isPreviewMode?: boolean;
  readOnly?: boolean;
  screens?: Screen[];
}

const InlineKeyboard = ({
  keyboard,
  onButtonTextChange,
  onButtonUpdate,
  onDeleteButton,
  onButtonClick,
  isPreviewMode = false,
  readOnly = false,
  screens = [],
}: InlineKeyboardProps) => {
  const [editingButton, setEditingButton] = useState<string | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedButton, setSelectedButton] = useState<{ row: KeyboardRow; button: KeyboardButton } | null>(null);

  useEffect(() => {
    if (!selectedButton) return;
    const latestRow = keyboard.find((row) => row.id === selectedButton.row.id);
    const latestButton = latestRow?.buttons.find((btn) => btn.id === selectedButton.button.id);

    if (!latestRow || !latestButton) {
      setSelectedButton(null);
      setEditDialogOpen(false);
      return;
    }

    if (latestRow !== selectedButton.row || latestButton !== selectedButton.button) {
      setSelectedButton({ row: latestRow, button: latestButton });
    }
  }, [keyboard, selectedButton]);

  const handleTextEditClick = (buttonId: string) => {
    setEditingButton(buttonId);
  };

  const handleTextChange = (rowId: string, buttonId: string, newText: string) => {
    // Limit text length to prevent overflow
    const truncatedText = newText.slice(0, 30);
    onButtonTextChange(rowId, buttonId, truncatedText);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  };

  const handleEditClick = (row: KeyboardRow, button: KeyboardButton) => {
    setSelectedButton({ row, button });
    setEditDialogOpen(true);
  };

  const handleSaveButton = (updatedButton: KeyboardButton) => {
    if (selectedButton && onButtonUpdate) {
      onButtonUpdate(selectedButton.row.id, selectedButton.button.id, updatedButton);
    }
  };

  const handleDialogOpenChange = (open: boolean) => {
    setEditDialogOpen(open);
    if (!open) {
      setSelectedButton(null);
    }
  };

  return (
    <>
      {selectedButton && (
        <ButtonEditDialog
          open={editDialogOpen}
          onOpenChange={handleDialogOpenChange}
          button={selectedButton.button}
          onSave={handleSaveButton}
          screens={screens}
        />
      )}
      <div className="space-y-[2px] mt-[2px]">
        {keyboard.map((row) => (
          <div key={row.id} className="flex gap-[2px]">
            {row.buttons.map((button) => (
              <div
                key={button.id}
                className="relative flex-1 group"
                style={{ maxWidth: `${100 / row.buttons.length}%` }}
              >
              <button
                onClick={() => {
                  if (isPreviewMode && onButtonClick) {
                    onButtonClick(button);
                  } else if (!readOnly && !isPreviewMode) {
                    handleTextEditClick(button.id);
                  }
                }}
                onDoubleClick={() => {
                  // 双击才能编辑文本，防止误触
                  if (!readOnly && !isPreviewMode) {
                    handleTextEditClick(button.id);
                  }
                }}
                className="w-full bg-telegram-button hover:bg-telegram-button/80 text-telegram-buttonText border-none rounded-md py-2 px-3 text-[15px] font-medium transition-colors relative overflow-hidden"
                title={isPreviewMode ? "点击执行操作" : "双击编辑文本"}
              >
                  {!readOnly && !isPreviewMode && editingButton === button.id ? (
                    <input
                      type="text"
                      value={button.text}
                      onChange={(e) => handleTextChange(row.id, button.id, e.target.value)}
                      onBlur={() => setEditingButton(null)}
                      onPaste={handlePaste}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          setEditingButton(null);
                        }
                        if (e.key === 'Escape') {
                          setEditingButton(null);
                        }
                      }}
                      autoFocus
                      className="w-full bg-transparent outline-none text-center"
                      maxLength={30}
                    />
                  ) : (
                    <span className="truncate block">{button.text}</span>
                  )}
                </button>
                {!readOnly && (
                  <>
                    {/* 状态标记 */}
                    {button.linked_screen_id && (
                      <div className="absolute -top-1 -left-1 w-3 h-3 bg-green-500 rounded-full opacity-80 group-hover:opacity-0 transition-opacity" 
                           title="已配置跳转模版" />
                    )}
                    {button.url && (
                      <div className="absolute -top-1 -left-1 w-3 h-3 bg-blue-500 rounded-full opacity-80 group-hover:opacity-0 transition-opacity" 
                           title="已配置URL链接" />
                    )}
                    {!button.url && !button.linked_screen_id && (
                      <div className="absolute -top-1 -left-1 w-3 h-3 bg-yellow-500 rounded-full opacity-80 group-hover:opacity-0 transition-opacity" 
                           title="未配置跳转目标" />
                    )}
                    
                    <button
                      onClick={() => handleEditClick(row, button)}
                      className="absolute -top-2 -right-2 w-5 h-5 bg-primary text-primary-foreground rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow-md"
                      aria-label="Edit button"
                      title="配置按钮跳转"
                    >
                      <Settings className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => onDeleteButton?.(row.id, button.id)}
                      className="absolute -top-2 -right-8 w-5 h-5 bg-destructive text-destructive-foreground rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow-md"
                      aria-label="Delete button"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
};

export default InlineKeyboard;
