import { describe, it, expect } from "vitest";
import { getKeyboardValidationErrors, MAX_BUTTONS_PER_ROW, MAX_KEYBOARD_ROWS, validateKeyboard, validateMessageContent, validateScreen } from "../validation";

describe("validation", () => {
  it("validates a minimal screen", () => {
    const keyboard = [
      {
        id: "row-1",
        buttons: [{ id: "btn-1", text: "Go", callback_data: "ok" }],
      },
    ];
    const screen = {
      id: "s1",
      name: "Sample",
      message_content: "Hello",
      keyboard,
      is_public: false,
    };

    expect(() => validateScreen(screen)).not.toThrow();
    expect(() => validateKeyboard(keyboard)).not.toThrow();
    expect(() => validateMessageContent("hi")).not.toThrow();
  });

  it("rejects callback_data over 64 bytes", () => {
    const badKeyboard = [
      {
        id: "row-1",
        buttons: [{ id: "btn-1", text: "Bad", callback_data: "あ".repeat(33) }], // multibyte to exceed 64 bytes
      },
    ];
    expect(() => validateKeyboard(badKeyboard)).toThrow(/第1行第1个按钮.*64/);
  });

  it("rejects empty message content", () => {
    expect(() => validateMessageContent("")).toThrow(/不能为空/);
  });

  it("reports row and button limits with readable messages", () => {
    const overFlowKeyboard = [
      {
        id: "row-1",
        buttons: Array.from({ length: MAX_BUTTONS_PER_ROW + 1 }).map((_, idx) => ({
          id: `btn-${idx}`,
          text: `B${idx}`,
          callback_data: `cb_${idx}`,
        })),
      },
    ];
    const rowErrors = getKeyboardValidationErrors(overFlowKeyboard);
    expect(rowErrors[0]).toMatch(new RegExp(`每行最多\\s*${MAX_BUTTONS_PER_ROW}个按钮`));

    const tooManyRows = Array.from({ length: MAX_KEYBOARD_ROWS + 1 }).map((_, idx) => ({
      id: `row-${idx}`,
      buttons: [{ id: `btn-${idx}`, text: "ok", callback_data: "cb" }],
    }));
    const keyboardErrors = getKeyboardValidationErrors(tooManyRows);
    expect(keyboardErrors[0]).toMatch(`最多${MAX_KEYBOARD_ROWS}行`);
  });
});
