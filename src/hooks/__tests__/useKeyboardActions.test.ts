import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useKeyboardActions } from "../chat/useKeyboardActions";
import { MAX_BUTTONS_PER_ROW, MAX_KEYBOARD_ROWS } from "@/lib/validation";

const toast = vi.hoisted(() => ({
  warning: vi.fn(),
  error: vi.fn(),
}));

vi.mock("sonner", () => ({ toast }));

describe("useKeyboardActions limits", () => {
  beforeEach(() => {
    Object.values(toast).forEach((fn) => fn.mockReset());
  });

  it("warns and starts a new row when the last row is full", () => {
    let keyboard = [
      {
        id: "row-1",
        buttons: Array.from({ length: MAX_BUTTONS_PER_ROW }, (_, idx) => ({
          id: `btn-${idx}`,
          text: `Button ${idx}`,
          callback_data: `cb_${idx}`,
        })),
      },
    ];

    const setKeyboard = (updater: Parameters<typeof useKeyboardActions>[0]) => {
      keyboard = typeof updater === "function" ? updater(keyboard) : updater;
    };
    const pushToHistory = vi.fn();

    const { result } = renderHook(() =>
      useKeyboardActions(setKeyboard, pushToHistory, "draft", keyboard)
    );

    act(() => {
      result.current.handleAddButton();
    });

    expect(keyboard.length).toBe(2);
    expect(keyboard[1].buttons).toHaveLength(1);
    expect(toast.warning).toHaveBeenCalledWith(
      expect.stringContaining(`${MAX_BUTTONS_PER_ROW}`)
    );
    expect(pushToHistory).toHaveBeenCalledWith("draft", keyboard);
  });

  it("blocks adding rows when exceeding the maximum and surfaces an error", () => {
    let keyboard = Array.from({ length: MAX_KEYBOARD_ROWS }, (_, idx) => ({
      id: `row-${idx}`,
      buttons: [{ id: `btn-${idx}`, text: "Button", callback_data: "cb" }],
    }));
    const setKeyboard = (updater: Parameters<typeof useKeyboardActions>[0]) => {
      keyboard = typeof updater === "function" ? updater(keyboard) : updater;
    };
    const pushToHistory = vi.fn();

    const { result } = renderHook(() =>
      useKeyboardActions(setKeyboard, pushToHistory, "draft", keyboard)
    );

    act(() => {
      result.current.handleAddRow();
    });

    expect(keyboard).toHaveLength(MAX_KEYBOARD_ROWS);
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining(`${MAX_KEYBOARD_ROWS}`)
    );
    expect(pushToHistory).not.toHaveBeenCalled();
  });
});
