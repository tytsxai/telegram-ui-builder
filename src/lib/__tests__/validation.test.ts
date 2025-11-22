import { describe, it, expect } from "vitest";
import { validateKeyboard, validateMessageContent, validateScreen } from "../validation";

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
        buttons: [{ id: "btn-1", text: "Bad", callback_data: "a".repeat(65) }],
      },
    ];
    expect(() => validateKeyboard(badKeyboard)).toThrow(/64字节/);
  });

  it("rejects empty message content", () => {
    expect(() => validateMessageContent("")).toThrow(/不能为空/);
  });
});
