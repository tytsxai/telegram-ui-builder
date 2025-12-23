import { useState, useEffect, forwardRef, useImperativeHandle, useRef, useCallback, useMemo } from "react";
import DOMPurify from "dompurify";
import { debounce } from "@/lib/debounce";

const MAX_PREVIEW_LENGTH = 500;

const ALLOWED_URL_PROTOCOLS = ['http:', 'https:', 'ftp:', 'mailto:', 'tel:', 'data:'] as const;

const isValidUrlProtocol = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return ALLOWED_URL_PROTOCOLS.includes(parsed.protocol as (typeof ALLOWED_URL_PROTOCOLS)[number]);
  } catch {
    return false;
  }
};

const getCodePointLength = (text: string) => Array.from(text).length;
const sliceByCodePoints = (text: string, maxLength: number) =>
  Array.from(text).slice(0, maxLength).join("");

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
  const [isExpanded, setIsExpanded] = useState(false);
  const lastContentRef = useRef<string>("");

  const truncateText = useCallback((text: string, maxLength = MAX_PREVIEW_LENGTH) => {
    if (!text) return "";
    if (getCodePointLength(text) <= maxLength) return text;
    return `${sliceByCodePoints(text, maxLength)}...`;
  }, []);

  const shouldTruncate = readOnly && getCodePointLength(content) > MAX_PREVIEW_LENGTH;
  const displayContent = useMemo(() => {
    if (!shouldTruncate) return content;
    return isExpanded ? content : truncateText(content);
  }, [content, isExpanded, shouldTruncate, truncateText]);

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

  const escapeUrlForAttr = (url: string) =>
    url.replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const formatMessage = useCallback((text: string): string => {
    let safe = escapeHtml(text);
    safe = safe
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, linkText, url) => {
        if (!isValidUrlProtocol(url)) {
          return `<span class="text-red-500 underline" title="无效的 URL 协议">${linkText}</span>`;
        }
        return `<a href="${escapeUrlForAttr(url)}" target="_blank" rel="noopener noreferrer" class="underline">${linkText}</a>`;
      })
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/_(.*?)_/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code class="bg-black/10 dark:bg-white/10 px-1 py-0.5 rounded text-sm font-mono">$1</code>')
      .replace(/\n/g, '<br>');
    return DOMPurify.sanitize(safe, {
      ALLOWED_TAGS: ['a', 'strong', 'em', 'code', 'br', 'span'],
      ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'title'],
      ALLOW_DATA_ATTR: false,
    });
  }, [escapeHtml]);

  const htmlToMarkup = useCallback((html: string): string => {
    if (!html.includes("<") && !html.includes("&")) return html;
    const brOnly = html.replace(/<br\s*\/?>/gi, "\n");
    if (!brOnly.includes("<") && !brOnly.includes("&")) return brOnly;

    const sanitizedHtml = DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ['a', 'strong', 'em', 'code', 'br', 'span'],
      ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'title'],
      ALLOW_DATA_ATTR: false,
    });
    const container = document.createElement('div');
    container.innerHTML = sanitizedHtml;

    const walk = (node: Node, depth = 0): string => {
      const MAX_DEPTH = 50;
      if (depth > MAX_DEPTH) return '';

      if (node.nodeType === Node.TEXT_NODE) {
        return (node.textContent ?? '');
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        if (el.tagName === 'BR') return '\n';
        if (el.tagName === 'CODE') {
          let inner = '';
          for (let i = 0; i < el.childNodes.length; i++) {
            inner += walk(el.childNodes[i], depth + 1);
          }
          return `\`${inner}\``;
        }
        if (el.tagName === 'STRONG' || el.tagName === 'B') {
          let inner = '';
          for (let i = 0; i < el.childNodes.length; i++) {
            inner += walk(el.childNodes[i], depth + 1);
          }
          return `**${inner}**`;
        }
        if (el.tagName === 'EM' || el.tagName === 'I') {
          let inner = '';
          for (let i = 0; i < el.childNodes.length; i++) {
            inner += walk(el.childNodes[i], depth + 1);
          }
          return `_${inner}_`;
        }
        if (el.tagName === 'A') {
          const href = el.getAttribute('href') || '';
          let inner = '';
          for (let i = 0; i < el.childNodes.length; i++) {
            inner += walk(el.childNodes[i], depth + 1);
          }
          if (!href) return inner;
          return `[${inner}](${href})`;
        }
        // Default: serialize children (span and other tags)
        let out = '';
        for (let i = 0; i < el.childNodes.length; i++) {
          out += walk(el.childNodes[i], depth + 1);
        }
        return out;
      }
      return '';
    };

    let result = '';
    for (let i = 0; i < container.childNodes.length; i++) {
      result += walk(container.childNodes[i]);
    }
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
    setIsExpanded(false);
  }, [content]);

  useEffect(() => {
    if (editableRef.current) {
      const formatted = formatMessage(displayContent);
      if (editableRef.current.innerHTML !== formatted) {
        // Only update if content actually changed from external source
        if (readOnly || lastContentRef.current !== content) {
          editableRef.current.innerHTML = formatted;
          lastContentRef.current = content;
        }
      }
    }
  }, [content, displayContent, formatMessage, readOnly]);

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

  const insertPlainText = (text: string) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !editableRef.current) return;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const frag = document.createDocumentFragment();
    const lines = text.split("\n");
    lines.forEach((line, idx) => {
      frag.appendChild(document.createTextNode(line));
      if (idx !== lines.length - 1) {
        frag.appendChild(document.createElement('br'));
      }
    });
    range.insertNode(frag);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    insertPlainText(text);

    // Normalize and sync after paste
    setTimeout(() => {
      if (!editableRef.current) return;
      const htmlNow = editableRef.current.innerHTML;
      const markupNow = htmlToMarkup(htmlNow);
      const formatted = formatMessage(markupNow);
      editableRef.current.innerHTML = formatted;
      lastContentRef.current = markupNow;
      if (onContentChange) onContentChange(markupNow || "");
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


  const formattingHintId = "message-bubble-formatting-hint";
  const formattingHintSrId = "message-bubble-formatting-hint-sr";

  return (
    <div>
      <div className="bg-telegram-sent text-foreground rounded-2xl rounded-br-md px-3 py-2 shadow-sm">
        <div
          ref={editableRef}
          role="textbox"
          aria-label="Message body"
          aria-multiline="true"
          aria-describedby={`${formattingHintId} ${formattingHintSrId}`}
          tabIndex={0}
          contentEditable={!readOnly}
          onInput={handleInput}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          className="outline-none min-h-[20px] whitespace-pre-wrap break-words text-[15px] leading-[1.35] font-telegram"
          suppressContentEditableWarning
        />
        {shouldTruncate ? (
          <div className="mt-1 flex justify-start">
            <button
              type="button"
              onClick={() => setIsExpanded((prev) => !prev)}
              className="text-[11px] font-telegram text-white/80 hover:text-white underline underline-offset-2"
            >
              {isExpanded ? "收起" : "展开"}
            </button>
          </div>
        ) : null}
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
      <p id={formattingHintSrId} className="sr-only">
        按 Enter 插入空行，Shift+Enter 插入单行；支持粗体、斜体、代码、链接格式。
      </p>

      <details className="mt-2 text-[11px] text-muted-foreground">
        <summary className="cursor-pointer select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-foreground/40 rounded px-1">
          格式提示
        </summary>
        <div
          id={formattingHintId}
          className="mt-1 flex flex-col gap-1 rounded border border-border/50 bg-gradient-to-br from-muted/90 via-muted/60 to-muted/40 dark:from-muted/60 dark:via-muted/50 dark:to-muted/40 px-3 py-2 text-foreground/90 shadow-sm"
        >
          <div className="flex items-center gap-2 text-[11px] font-semibold tracking-wide uppercase text-foreground/80">
            <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-foreground/10 text-[10px]">i</span>
            格式与快捷键
          </div>
          <ul className="list-disc list-inside space-y-1 leading-relaxed text-[11px]">
            <li className="flex flex-wrap gap-1">
              <span className="inline-flex items-center gap-1 rounded bg-foreground/5 px-1 py-[2px] text-foreground">Enter</span>
              <span className="text-foreground/80">空一行</span>
              <span className="text-foreground/60">·</span>
              <span className="inline-flex items-center gap-1 rounded bg-foreground/5 px-1 py-[2px] text-foreground">Shift+Enter</span>
              <span className="text-foreground/80">单行换行</span>
            </li>
            <li className="flex flex-wrap gap-1 text-foreground/85">
              支持 <span className="font-semibold">**粗体**</span> / <span className="italic">_斜体_</span> / <code className="rounded bg-foreground/10 px-1 py-[1px] text-[10px]">`代码`</code> / <span className="underline decoration-dashed">[文本](url)</span>
            </li>
          </ul>
        </div>
      </details>
    </div>
  );
});

export default MessageBubble;
