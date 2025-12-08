import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { useKeyboardActions } from "../useKeyboardActions";
import { MAX_BUTTONS_PER_ROW, MAX_KEYBOARD_ROWS } from "@/lib/validation";

vi.mock("sonner", () => ({
  toast: {
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

const buildFullKeyboard = () =>
  Array.from({ length: MAX_KEYBOARD_ROWS }).map((_, rowIdx) => ({
    id: `row-${rowIdx}`,
    buttons: Array.from({ length: MAX_BUTTONS_PER_ROW }).map((_, btnIdx) => ({
      id: `btn-${rowIdx}-${btnIdx}`,
      text: `Btn ${btnIdx}`,
      callback_data: `cb_${rowIdx}_${btnIdx}`,
    })),
  }));

describe("useKeyboardActions", () => {
  it("persists reorder and pushes to history", () => {
    const pushToHistory = vi.fn();
    const initialKeyboard = [
      {
        id: "row-1",
        buttons: [
          { id: "btn-1", text: "One", callback_data: "one" },
          { id: "btn-2", text: "Two", callback_data: "two" },
        ],
      },
      {
        id: "row-2",
        buttons: [{ id: "btn-3", text: "Three", callback_data: "three" }],
      },
    ];

    const { result } = renderHook(() => {
      const [keyboard, setKeyboard] = useState(initialKeyboard);
      const actions = useKeyboardActions(setKeyboard, pushToHistory, "msg", keyboard);
      return { keyboard, actions };
    });

    const reordered = [initialKeyboard[1], initialKeyboard[0]];
    act(() => {
      result.current.actions.handleReorder(reordered);
    });

    expect(result.current.keyboard[0].id).toBe("row-2");
    expect(pushToHistory).toHaveBeenCalledWith("msg", reordered);
  });

  it("blocks adding buttons when row limit is reached", () => {
    const pushToHistory = vi.fn();
    const fullKeyboard = buildFullKeyboard();

    const { result } = renderHook(() => {
      const [keyboard, setKeyboard] = useState(fullKeyboard);
      const actions = useKeyboardActions(setKeyboard, pushToHistory, "msg", keyboard);
      return { keyboard, actions };
    });

    act(() => {
      result.current.actions.handleAddButton();
    });

    expect(result.current.keyboard.length).toBe(MAX_KEYBOARD_ROWS);
    expect(pushToHistory).not.toHaveBeenCalled();
  });
});
