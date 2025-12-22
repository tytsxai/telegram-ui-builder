import { describe, it, expect, vi } from "vitest";
import { FlowExportSchema, getKeyboardValidationErrors, isUrlProtocolAllowed, MAX_BUTTONS_PER_ROW, MAX_KEYBOARD_ROWS, MessageContentSchema, screenContainsSensitiveData, ScreenSchema, validateButton, validateCallbackData, validateFlowExport, validateKeyboard, validateMessageContent, validateScreen, validateUrlProtocol } from "../validation";

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

  it("rejects whitespace-only message content", () => {
    expect(() => validateMessageContent("   ")).toThrow(/不能为空/);
  });

  it("rejects nullish message content", () => {
    expect(() => validateMessageContent(null)).toThrow(/不能为空/);
    expect(() => validateMessageContent(undefined)).toThrow(/不能为空/);
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

  it("detects sensitive wallet data in content or keyboard", () => {
    const messageContent = "Send to 0x52908400098527886E0F7030069857D2E4169EE7";
    const keyboard = [
      {
        id: "row-1",
        buttons: [{ id: "btn-1", text: "Pay", url: "https://example.com" }],
      },
    ];
    expect(screenContainsSensitiveData(messageContent, keyboard)).toBe(true);
    expect(screenContainsSensitiveData("No secrets here", keyboard)).toBe(false);
    const keyboardWithBtc = [
      {
        id: "row-1",
        buttons: [{ id: "btn-1", text: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080" }],
      },
    ];
    expect(screenContainsSensitiveData("No secrets here", keyboardWithBtc)).toBe(true);
  });

  it("detects an ETH address in message content", () => {
    expect(
      screenContainsSensitiveData("0x52908400098527886E0F7030069857D2E4169EE7", [])
    ).toBe(true);
  });

  it("detects a Tron address in message content", () => {
    expect(
      screenContainsSensitiveData("T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb", [])
    ).toBe(true);
  });

  it("detects Bitcoin addresses (bech32 / legacy / p2sh) in message content", () => {
    const samples = [
      "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080",
      "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2",
      "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy",
    ];
    for (const address of samples) {
      expect(screenContainsSensitiveData(`pay to ${address} please`, [])).toBe(true);
    }
  });

  it("detects addresses inside nested keyboard JSON (text/url/callback_data)", () => {
    const eth = "0x52908400098527886E0F7030069857D2E4169EE7";
    const tron = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb";
    const btc = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2";

    const keyboard = [
      {
        id: "row-1",
        buttons: [
          { id: "btn-1", text: `Send ${eth}`, callback_data: "ok" },
          { id: "btn-2", text: "Open", url: `https://example.com/pay?to=${tron}` },
          { id: "btn-3", text: "Callback", callback_data: JSON.stringify({ to: btc }) },
        ],
      },
    ];

    expect(screenContainsSensitiveData("No secrets here", keyboard)).toBe(true);
  });

  it("does not flag near-miss strings that look like addresses", () => {
    const notAddresses = [
      // ETH: wrong length (39 hex chars instead of 40)
      "0x52908400098527886E0F7030069857D2E4169E", // 39 hex chars - too short

      // Regular text that shouldn't match
      "Hello world",
      "Transfer complete",
      "0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG", // invalid hex chars

      // Short strings that look like prefixes but aren't addresses
      "0x123",
      "bc1short",
      "Tshort",
    ];

    for (const sample of notAddresses) {
      expect(screenContainsSensitiveData(sample, [])).toBe(false);
    }
  });

  it("rejects forbidden URL protocols (javascript/data/vbscript)", () => {
    const forbiddenUrls = [
      "javascript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
      "vbscript:msgbox(1)",
      "JAVASCRIPT:alert(1)",
    ];

    for (const url of forbiddenUrls) {
      expect(isUrlProtocolAllowed(url)).toBe(false);
      expect(() => validateUrlProtocol(url)).toThrow(/禁止的URL协议/);
    }
  });

  it("allows safe URL protocols (https/http)", () => {
    const safeUrls = [
      "https://example.com",
      "http://example.com/path?q=1",
      "https://example.com/page#section",
    ];

    for (const url of safeUrls) {
      expect(isUrlProtocolAllowed(url)).toBe(true);
      expect(() => validateUrlProtocol(url)).not.toThrow();
    }
  });

  it("rejects buttons with forbidden URL protocols in keyboard validation", () => {
    const keyboard = [
      {
        id: "row-1",
        buttons: [{ id: "btn-1", text: "Bad", url: "javascript:alert(1)" }],
      },
    ];
    expect(() => validateKeyboard(keyboard)).toThrow(/禁止的URL协议/);
  });

  it("treats trimmed empty URL as allowed", () => {
    expect(validateUrlProtocol("   ")).toBe("");
    expect(validateUrlProtocol(null)).toBe("");
  });

  it("accepts emoji and special characters in content and callback_data", () => {
    const message = "Hello 😄✨ — ©®✓";
    expect(() => validateMessageContent(message)).not.toThrow();

    const callback = "ok-😀-✓";
    expect(() => validateCallbackData(callback)).not.toThrow();
  });

  it("counts grapheme clusters for emoji and combining characters", () => {
    const emojiText = "😀".repeat(30);
    expect(() => validateButton({ id: "btn-emoji-ok", text: emojiText })).not.toThrow();
    expect(() => validateButton({ id: "btn-emoji-bad", text: emojiText + "😀" })).toThrow(/按钮文本最多30个字符/);

    const combining = "e\u0301".repeat(30);
    expect(() => validateButton({ id: "btn-combine-ok", text: combining })).not.toThrow();
    expect(() => validateButton({ id: "btn-combine-bad", text: combining + "e\u0301" })).toThrow(/按钮文本最多30个字符/);
  });

  it("handles relative and invalid URLs safely", () => {
    expect(isUrlProtocolAllowed("/relative/path")).toBe(true);
    expect(isUrlProtocolAllowed("not a url")).toBe(false);
    expect(() => validateUrlProtocol(123)).toThrow(/无效的URL格式/);
  });

  it("validates button text trimming and callback_data bounds", () => {
    const validButton = { id: "btn-1", text: " OK ", url: "https://example.com" };
    expect(() => validateKeyboard([{ id: "row-1", buttons: [validButton] }])).not.toThrow();

    const badTextButton = { id: "btn-2", text: "   " };
    expect(() => validateKeyboard([{ id: "row-1", buttons: [badTextButton] }])).toThrow(/按钮文本不能为空/);

    expect(() => validateCallbackData("あ".repeat(33))).toThrow(/64/);
    expect(validateCallbackData(null)).toBe("");
    expect(() => validateCallbackData(123)).toThrow(/64/);
  });

  it("reports screen and flow export validation errors", () => {
    const badScreen = { id: "s1", name: "   ", message_content: "ok", keyboard: [], is_public: true };
    expect(() => validateScreen(badScreen)).toThrow(/模版名称不能为空/);

    const badExport = { version: "1", entry_screen_id: "s1", screens: ["bad"] };
    expect(() => validateFlowExport(badExport)).toThrow(/流程数据验证失败/);
  });

  it("validates button payloads directly", () => {
    expect(() => validateButton({ id: "btn-1", text: "Go", callback_data: "ok" })).not.toThrow();
    expect(() => validateButton({ id: "btn-2", text: "" })).toThrow(/按钮文本不能为空/);
  });

  it("rethrows unexpected parsing errors", () => {
    const messageSpy = vi.spyOn(MessageContentSchema, "parse").mockImplementation(() => {
      throw new Error("boom");
    });
    try {
      expect(() => validateMessageContent("ok")).toThrow(/boom/);
    } finally {
      messageSpy.mockRestore();
    }

    const screenSpy = vi.spyOn(ScreenSchema, "parse").mockImplementation(() => {
      throw new Error("screen-boom");
    });
    try {
      expect(() => validateScreen({})).toThrow(/screen-boom/);
    } finally {
      screenSpy.mockRestore();
    }

    const flowSpy = vi.spyOn(FlowExportSchema, "parse").mockImplementation(() => {
      throw new Error("flow-boom");
    });
    try {
      expect(() => validateFlowExport({})).toThrow(/flow-boom/);
    } finally {
      flowSpy.mockRestore();
    }
  });

  it("handles keyboard validation and sensitive data edge cases", () => {
    const validKeyboard = [{ id: "row-1", buttons: [{ id: "btn-1", text: "ok" }] }];
    expect(getKeyboardValidationErrors(validKeyboard)).toEqual([]);

    const rowErrors = getKeyboardValidationErrors([null]);
    expect(rowErrors[0]).toMatch(/第1行/);

    const buttonErrors = getKeyboardValidationErrors([{ id: "row-1", buttons: [null] }]);
    expect(buttonErrors[0]).toMatch(/第1行第1个按钮/);

    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(screenContainsSensitiveData("clean", circular)).toBe(false);
  });
});
