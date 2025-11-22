import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useChatState } from "../chat/useChatState";
import type { KeyboardRow } from "@/types/telegram";

describe("useChatState", () => {
  it("converts content into Telegram export format and keeps editable JSON in sync", async () => {
    const { result } = renderHook(() => useChatState());

    const keyboard: KeyboardRow[] = [
      {
        id: "row-1",
        buttons: [
          { id: "btn-1", text: "Visit", url: "https://example.com" },
          { id: "btn-2", text: "Next", linked_screen_id: "screen-2" },
          { id: "btn-3", text: "Fallback Action" },
        ],
      },
    ];

    act(() => {
      result.current.setMessageContent("Hello **World** `code` _italic_");
      result.current.setKeyboard(keyboard);
      result.current.setParseMode("HTML");
      result.current.setMessageType("text");
    });

    await waitFor(() => {
      const parsed = JSON.parse(result.current.editableJSON);
      expect(parsed.parse_mode).toBe("HTML");
      expect(parsed.text).toBe("Hello <b>World</b> <code>code</code> <i>italic</i>");
      expect(parsed.reply_markup.inline_keyboard[0]).toEqual([
        { text: "Visit", url: "https://example.com" },
        { text: "Next", callback_data: "goto_screen_screen-2" },
        { text: "Fallback Action", callback_data: "fallback_action" },
      ]);
    });

    const payload = result.current.convertToTelegramFormat();
    expect(payload.reply_markup?.inline_keyboard[0][1].callback_data).toBe("goto_screen_screen-2");
  });

  it("supports media payload and MarkdownV2", async () => {
    const { result } = renderHook(() => useChatState());

    act(() => {
      result.current.setMessageContent("**bold**");
      result.current.setMediaUrl("https://example.com/photo.jpg");
      result.current.setMessageType("photo");
      result.current.setParseMode("MarkdownV2");
    });

    const payload = result.current.convertToTelegramFormat();
    if ("photo" in payload) {
      expect(payload.photo).toBe("https://example.com/photo.jpg");
      expect(payload.caption).toContain("**bold**");
      expect(payload.parse_mode).toBe("MarkdownV2");
    } else {
      throw new Error("Expected photo payload");
    }
  });

  it("tracks history and supports undo/redo", () => {
    const { result } = renderHook(() => useChatState());

    act(() => {
      result.current.pushToHistory(result.current.messageContent, result.current.keyboard);
    });

    act(() => {
      result.current.setMessageContent("First change");
      result.current.setKeyboard([
        { id: "row-a", buttons: [{ id: "btn-a", text: "A", callback_data: "cb_a" }] },
      ]);
      result.current.pushToHistory("First change", [
        { id: "row-a", buttons: [{ id: "btn-a", text: "A", callback_data: "cb_a" }] },
      ]);
    });

    act(() => {
      result.current.setMessageContent("Second change");
      result.current.setKeyboard([
        { id: "row-b", buttons: [{ id: "btn-b", text: "B", callback_data: "cb_b" }] },
      ]);
      result.current.pushToHistory("Second change", [
        { id: "row-b", buttons: [{ id: "btn-b", text: "B", callback_data: "cb_b" }] },
      ]);
    });

    act(() => result.current.undo());
    expect(result.current.messageContent).toBe("First change");
    expect(result.current.keyboard[0].buttons[0].text).toBe("A");

    act(() => result.current.redo());
    expect(result.current.messageContent).toBe("Second change");
    expect(result.current.keyboard[0].buttons[0].text).toBe("B");
  });
});
