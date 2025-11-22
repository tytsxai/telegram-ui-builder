import { useState, useEffect, forwardRef, useImperativeHandle, useRef, useCallback, useMemo } from "react";
import { debounce } from "@/lib/debounce";

interface MessageBubbleProps {
  content: string;
  onContentChange?: (content: string) => void;
  readOnly?: boolean;
}

export type MessageBubbleHandle = {
  applyFormat: (format: 'bold' | 'italic' | 'code' | 'link', url?: string) => void;
  focus: () => void;
};

const MessageBubble = forwardRef<MessageBubbleHandle, MessageBubbleProps>(({ content, onContentChange, readOnly = false }, ref) => {
  const editableRef = useRef<HTMLDivElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const lastContentRef = useRef<string>("");

  const escapeHtml = useCallback(
    (str: string) =>
      str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;"),
    [],
  );

  const formatMessage = useCallback((text: string): string => {
    // 1) Escape raw HTML first
    let safe = escapeHtml(text);
    // 2) Convert markdown-like syntax to HTML (order matters)
    safe = safe
      // Links [text](url)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="underline">$1</a>')
      // Bold (all instances)
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      // Italic (all instances)
      .replace(/_(.*?)_/g, '<em>$1</em>')
      // Inline code (all instances)
      .replace(/`([^`]+)`/g, '<code class="bg-black/10 dark:bg-white/10 px-1 py-0.5 rounded text-sm font-mono">$1</code>')
      // Line breaks
      .replace(/\n/g, '<br>');
    return safe;
  }, [escapeHtml]);

  const htmlToMarkup = useCallback((html: string): string => {
    const container = document.createElement('div');
    container.innerHTML = html;

    const walk = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) {
        return (node.textContent ?? '');
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        if (el.tagName === 'BR') return '\n';
        if (el.tagName === 'CODE') {
          let inner = '';
          el.childNodes.forEach((n) => (inner += walk(n)));
          return '`' + inner + '`';
        }
        if (el.tagName === 'STRONG' || el.tagName === 'B') {
          let inner = '';
          el.childNodes.forEach((n) => (inner += walk(n)));
          return `**${inner}**`;
        }
        if (el.tagName === 'EM' || el.tagName === 'I') {
          let inner = '';
          el.childNodes.forEach((n) => (inner += walk(n)));
          return `_${inner}_`;
        }
        if (el.tagName === 'A') {
          const href = el.getAttribute('href') || '';
          let inner = '';
          el.childNodes.forEach((n) => (inner += walk(n)));
          if (!href) return inner;
          return `[${inner}](${href})`;
        }
        // Default: serialize children
        let out = '';
        el.childNodes.forEach((n) => (out += walk(n)));
        return out;
      }
      return '';
    };

    let result = '';
    container.childNodes.forEach((n) => (result += walk(n)));
    return result;
  }, []);

  const applyFormat = useCallback((format: 'bold' | 'italic' | 'code' | 'link', url?: string) => {
    if (!editableRef.current) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const cursorPos = saveCursorPosition();

    if (format === 'bold') {
      document.execCommand('bold');
    } else if (format === 'italic') {
      document.execCommand('italic');
    } else if (format === 'link') {
      const safeUrl = (url || '').trim();
      if (safeUrl) {
        document.execCommand('createLink', false, safeUrl);
      }
    } else if (format === 'code') {
      const text = selection.toString();
      if (!text) return;
      const escaped = escapeHtml(text).replace(/\n/g, '<br>');
      const codeHTML = `<code class="bg-black/10 dark:bg-white/10 px-1 py-0.5 rounded text-sm font-mono">${escaped}</code>`;
      document.execCommand('insertHTML', false, codeHTML);
    }

    setTimeout(() => {
      if (!editableRef.current) return;
      const html = editableRef.current.innerHTML;
      const markup = htmlToMarkup(html);
      const formatted = formatMessage(markup);

      if (editableRef.current.innerHTML !== formatted) {
        editableRef.current.innerHTML = formatted;
      }
      if (cursorPos !== null) {
        restoreCursorPosition(cursorPos);
      }
      lastContentRef.current = markup;
      if (onContentChange) onContentChange(markup);
    }, 0);
  }, [escapeHtml, formatMessage, htmlToMarkup, onContentChange]);

  useImperativeHandle(ref, () => ({
    applyFormat,
    focus: () => {
      editableRef.current?.focus();
    }
  }));


  useEffect(() => {
    if (editableRef.current) {
      const formatted = formatMessage(content);
      if (editableRef.current.innerHTML !== formatted) {
        // Only update if content actually changed from external source
        if (lastContentRef.current !== content) {
          editableRef.current.innerHTML = formatted;
          lastContentRef.current = content;
        }
      }
    }
  }, [content, formatMessage]);

  const saveCursorPosition = () => {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount || !editableRef.current) return null;

    const range = selection.getRangeAt(0);
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(editableRef.current);
    preCaretRange.setEnd(range.endContainer, range.endOffset);
    const offset = preCaretRange.toString().length;

    return offset;
  };

  const restoreCursorPosition = (offset: number) => {
    if (!editableRef.current) return;

    const selection = window.getSelection();
    const range = document.createRange();
    let charCount = 0;
    const nodeStack: Node[] = [editableRef.current];
    let node: Node | undefined;
    let foundStart = false;

    while (!foundStart && (node = nodeStack.pop())) {
      if (node.nodeType === Node.TEXT_NODE) {
        const textNode = node as Text;
        const nextCharCount = charCount + (textNode.length || 0);
        if (offset <= nextCharCount) {
          range.setStart(textNode, offset - charCount);
          range.collapse(true);
          foundStart = true;
          break;
        }
        charCount = nextCharCount;
      } else {
        for (let i = node.childNodes.length - 1; i >= 0; i--) {
          nodeStack.push(node.childNodes[i]);
        }
      }
    }

    if (foundStart) {
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  };

  const handleInput = useMemo(
    () =>
      debounce(() => {
        if (!editableRef.current || !onContentChange) return;
        const html = editableRef.current.innerHTML;
        const markup = htmlToMarkup(html);
        lastContentRef.current = markup;
        onContentChange(markup);
      }, 300),
    [onContentChange, htmlToMarkup],
  );

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    const html = escapeHtml(text).replace(/\n/g, '<br>');
    document.execCommand('insertHTML', false, html);

    // Normalize and sync after paste
    setTimeout(() => {
      if (!editableRef.current) return;
      const htmlNow = editableRef.current.innerHTML;
      const markupNow = htmlToMarkup(htmlNow);
      const formatted = formatMessage(markupNow);
      editableRef.current.innerHTML = formatted;
      lastContentRef.current = markupNow;
      if (onContentChange) onContentChange(markupNow);
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Shift+Enter for single line break; Enter for paragraph (Telegram-ish spacing)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      document.execCommand('insertHTML', false, '<br><br>');
      return;
    }

    // Keyboard shortcuts
    if (e.ctrlKey || e.metaKey) {
      if (e.key.toLowerCase() === 'b') {
        e.preventDefault();
        applyFormat('bold');
        return;
      }
      if (e.key.toLowerCase() === 'i') {
        e.preventDefault();
        applyFormat('italic');
        return;
      }
    }
  };


  return (
    <div>
      <div className="bg-telegram-sent text-foreground rounded-2xl rounded-br-md px-3 py-2 shadow-sm">
        <div
          ref={editableRef}
          contentEditable={!readOnly}
          onInput={handleInput}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          className="outline-none min-h-[20px] whitespace-pre-wrap break-words text-[15px] leading-[1.35] font-telegram"
          suppressContentEditableWarning
        />
        <div className="flex items-center justify-end gap-1 mt-1">
          <span className="text-[11px] text-white/70 font-telegram">12:34</span>
          <svg className="w-4 h-4 text-white/70" viewBox="0 0 16 16" fill="none">
            <path
              d="M5.5 8.5L7 10L10.5 6.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M9.5 8.5L11 10L14.5 6.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
    </div>
  );
});

export default MessageBubble;
