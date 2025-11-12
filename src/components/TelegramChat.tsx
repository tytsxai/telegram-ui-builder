import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Plus, Save, Trash2, FileText, Bold, Italic, Code, Link } from "lucide-react";
import MessageBubble, { MessageBubbleHandle } from "./MessageBubble";
import InlineKeyboard from "./InlineKeyboard";

export interface KeyboardButton {
  id: string;
  text: string;
  url?: string;
  callback_data?: string;
  linked_screen_id?: string; // 链接到的模版ID
}

export interface KeyboardRow {
  id: string;
  buttons: KeyboardButton[];
}

type Screen = {
  id: string;
  name: string;
  messageContent: string;
  keyboard: KeyboardRow[];
};

const STORAGE_KEY = "telegram_ui_screens_v1";
const DEFAULT_MESSAGE = "Welcome to the Telegram UI Builder!\n\nEdit this message directly.\n\nFormatting:\n**bold text** for bold\n`code blocks` for code";
const DEFAULT_KEYBOARD: KeyboardRow[] = [
  {
    id: "row-1",
    buttons: [
      { id: "btn-1", text: "Button 1" },
      { id: "btn-2", text: "Button 2" },
    ],
  },
];

const TelegramChat = () => {
  const messageBubbleRef = useRef<MessageBubbleHandle>(null);
  const [messageContent, setMessageContent] = useState(DEFAULT_MESSAGE);
  const [keyboard, setKeyboard] = useState<KeyboardRow[]>(DEFAULT_KEYBOARD);

  const [screens, setScreens] = useState<Screen[]>([]);
  const [currentScreenId, setCurrentScreenId] = useState<string | undefined>(undefined);
  const [newScreenName, setNewScreenName] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setScreens(JSON.parse(raw));
    } catch (e) {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(screens));
    } catch (e) {
      // ignore
    }
  }, [screens]);

  const saveScreen = () => {
    const name = newScreenName.trim() || `Screen ${screens.length + 1}`;
    const id = `scr-${Date.now()}`;
    const screen: Screen = { id, name, messageContent, keyboard };
    setScreens((prev) => [...prev, screen]);
    setCurrentScreenId(id);
    setNewScreenName("");
  };

  const loadScreen = (id: string) => {
    const s = screens.find((x) => x.id === id);
    if (!s) return;
    setMessageContent(s.messageContent);
    setKeyboard(s.keyboard);
    setCurrentScreenId(id);
  };

  const deleteScreen = (id: string) => {
    setScreens((prev) => prev.filter((x) => x.id !== id));
    if (currentScreenId === id) setCurrentScreenId(undefined);
  };

  const createNewScreen = () => {
    setMessageContent(DEFAULT_MESSAGE);
    setKeyboard(DEFAULT_KEYBOARD);
    setCurrentScreenId(undefined);
    setNewScreenName("");
  };

  const handleAddButton = () => {
    setKeyboard((prev) => {
      const newKeyboard = [...prev];
      const lastRow = newKeyboard[newKeyboard.length - 1];
      
      if (lastRow && lastRow.buttons.length < 4) {
        // Add to existing row if it has less than 4 buttons
        lastRow.buttons.push({
          id: `btn-${Date.now()}`,
          text: `Button ${lastRow.buttons.length + 1}`,
        });
      } else {
        // Create new row
        newKeyboard.push({
          id: `row-${Date.now()}`,
          buttons: [{ id: `btn-${Date.now()}`, text: "Button 1" }],
        });
      }
      
      return newKeyboard;
    });
  };

  const handleAddRow = () => {
    setKeyboard((prev) => [
      ...prev,
      {
        id: `row-${Date.now()}`,
        buttons: [{ id: `btn-${Date.now()}`, text: "Button 1" }],
      },
    ]);
  };

  const handleButtonTextChange = (rowId: string, buttonId: string, newText: string) => {
    setKeyboard((prev) =>
      prev.map((row) =>
        row.id === rowId
          ? {
              ...row,
              buttons: row.buttons.map((btn) =>
                btn.id === buttonId ? { ...btn, text: newText } : btn
              ),
            }
          : row
      )
    );
  };

  const handleDeleteButton = (rowId: string, buttonId: string) => {
    setKeyboard((prev) => {
      const newKeyboard = prev.map((row) => {
        if (row.id === rowId) {
          return {
            ...row,
            buttons: row.buttons.filter((btn) => btn.id !== buttonId),
          };
        }
        return row;
      });
      
      // Remove empty rows
      return newKeyboard.filter((row) => row.buttons.length > 0);
    });
  };

  const handleFormatClick = (format: 'bold' | 'italic' | 'code' | 'link') => {
    if (format === 'link') {
      const url = prompt('Enter URL:');
      if (url) {
        messageBubbleRef.current?.applyFormat('link', url);
      }
    } else {
      messageBubbleRef.current?.applyFormat(format);
    }
    messageBubbleRef.current?.focus();
  };

  return (
    <div className="min-h-screen bg-telegram-bg flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Builder Controls */}
        <div className="mb-4 bg-card text-card-foreground p-3 rounded-lg shadow-sm">
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <Input
              placeholder="Screen name"
              value={newScreenName}
              onChange={(e) => setNewScreenName(e.target.value)}
              className="sm:max-w-xs"
              aria-label="Screen name"
            />
            <Button onClick={saveScreen} className="sm:w-auto">
              <Save className="w-4 h-4 mr-2" /> Save
            </Button>
            <Button onClick={createNewScreen} variant="outline" className="sm:w-auto">
              <FileText className="w-4 h-4 mr-2" /> New Screen
            </Button>
          </div>
          {screens.length > 0 && (
            <div className="mt-2 flex flex-col sm:flex-row gap-2 sm:items-center">
              <Select value={currentScreenId} onValueChange={loadScreen}>
                <SelectTrigger className="sm:w-64">
                  <SelectValue placeholder="Load a screen" />
                </SelectTrigger>
                <SelectContent>
                  {screens.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                onClick={() => currentScreenId && deleteScreen(currentScreenId)}
                disabled={!currentScreenId}
                className="sm:w-auto"
                aria-label="Delete selected screen"
              >
                <Trash2 className="w-4 h-4 mr-2" /> Delete
              </Button>
            </div>
          )}
        </div>

        {/* Telegram Header */}
        <div className="bg-telegram-header shadow-lg rounded-t-2xl overflow-hidden">
          <div className="px-4 py-3 flex items-center space-x-3">
            <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-semibold">
              TB
            </div>
            <div className="flex-1">
              <h2 className="text-white font-semibold text-base">Telegram Bot</h2>
              <p className="text-white/70 text-xs">online</p>
            </div>
          </div>
        </div>

        {/* Chat Container */}
        <div className="bg-telegram-bg shadow-lg font-telegram">
          <div className="p-4 min-h-[300px]">
            <div className="inline-block max-w-[85%]">
              <MessageBubble
                ref={messageBubbleRef}
                content={messageContent}
                onContentChange={setMessageContent}
              />
              {/* Inline Keyboard - attached to message */}
              <InlineKeyboard
                keyboard={keyboard}
                onButtonTextChange={handleButtonTextChange}
                onDeleteButton={handleDeleteButton}
              />
            </div>
          </div>

          {/* Formatting Toolbar */}
          <div className="px-4 pb-2 flex gap-2 border-t border-border/50 pt-3">
            <Button
              onClick={() => handleFormatClick('bold')}
              variant="outline"
              size="sm"
              className="flex-1"
              title="Bold (Ctrl+B)"
            >
              <Bold className="w-4 h-4" />
            </Button>
            <Button
              onClick={() => handleFormatClick('italic')}
              variant="outline"
              size="sm"
              className="flex-1"
              title="Italic (Ctrl+I)"
            >
              <Italic className="w-4 h-4" />
            </Button>
            <Button
              onClick={() => handleFormatClick('code')}
              variant="outline"
              size="sm"
              className="flex-1"
              title="Code block"
            >
              <Code className="w-4 h-4" />
            </Button>
            <Button
              onClick={() => handleFormatClick('link')}
              variant="outline"
              size="sm"
              className="flex-1"
              title="Link"
            >
              <Link className="w-4 h-4" />
            </Button>
          </div>

          {/* Action Buttons */}
          <div className="px-4 pb-4 flex gap-2">
            <Button
              onClick={handleAddButton}
              className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Button
            </Button>
            <Button
              onClick={handleAddRow}
              variant="outline"
              className="flex-1 border-primary text-primary hover:bg-primary/10"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Row
            </Button>
          </div>
        </div>

        {/* Bottom spacer for mobile feel */}
        <div className="h-2 bg-telegram-bg rounded-b-2xl shadow-lg"></div>
      </div>
    </div>
  );
};

export default TelegramChat;
