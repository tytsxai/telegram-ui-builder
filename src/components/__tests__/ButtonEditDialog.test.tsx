import { describe, it, expect } from "vitest";
import { validateButtonFields } from "../ButtonEditDialog";
import type { KeyboardButton } from "@/types/telegram";

const baseButton: KeyboardButton = {
  id: "btn-1",
  text: "Hello",
  callback_data: "action",
};

describe("ButtonEditDialog validation", () => {
  it("requires non-empty text and enforces 30 chars max", () => {
    expect(validateButtonFields({ ...baseButton, text: "" }, "callback").text).toBeDefined();
    const longText = "a".repeat(31);
    expect(validateButtonFields({ ...baseButton, text: longText }, "callback").text).toBe("按钮文本最多30个字符");
  });

  it("requires callback_data under 64 bytes when using callback", () => {
    const longPayload = "a".repeat(65);
    const errors = validateButtonFields({ ...baseButton, callback_data: longPayload }, "callback");
    expect(errors.callback).toBe("callback_data 最多 64 字节");
  });

  it("requires valid http(s) url when action is url", () => {
    expect(validateButtonFields({ ...baseButton, url: "" }, "url").url).toBeDefined();
    expect(validateButtonFields({ ...baseButton, url: "ftp://bad" }, "url").url).toBe("URL 需以 http(s) 开头");
    expect(validateButtonFields({ ...baseButton, url: "https://ok.com" }, "url").url).toBeUndefined();
  });

  it("requires linked screen when action is link", () => {
    expect(validateButtonFields({ ...baseButton, linked_screen_id: undefined }, "link").link).toBeDefined();
    expect(validateButtonFields({ ...baseButton, linked_screen_id: "s1" }, "link").link).toBeUndefined();
  });
});
