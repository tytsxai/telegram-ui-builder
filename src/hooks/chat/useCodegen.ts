import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

type Framework = "python-telegram-bot" | "aiogram" | "telegraf";

export const useCodegen = (
  convertToTelegramFormat: () => {
    text?: string;
    caption?: string;
    photo?: string;
    video?: string;
    parse_mode?: string;
    reply_markup?: { inline_keyboard?: Array<Array<{ text: string; url?: string; callback_data?: string }>> };
  },
  messageType: "text" | "photo" | "video"
) => {
  const [codegenFramework, setCodegenFramework] = useState<Framework>("python-telegram-bot");

  const generateCode = useCallback(
    (framework: Framework) => {
      const escapeStr = (val: string) => val.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
      const payload = convertToTelegramFormat();
      type ExportPayload = ReturnType<typeof convertToTelegramFormat>;
      type ExportInlineKeyboard = NonNullable<ExportPayload["reply_markup"]>["inline_keyboard"];
      const kb: ExportInlineKeyboard = payload.reply_markup?.inline_keyboard ?? [];

      const buildPythonInlineKeyboard = () =>
        kb
          .map(
            (row) =>
              "    [" +
              row
                .map((btn) => {
                  const action = btn.url ? `url="${escapeStr(btn.url)}"` : `callback_data="${escapeStr(btn.callback_data || "")}"`;
                  return `InlineKeyboardButton(text="${escapeStr(btn.text)}", ${action})`;
                })
                .join(", ") +
              "]"
          )
          .join("\n");

      const buildTelegrafKeyboard = () => {
        if (!kb.length) return "Markup.inlineKeyboard([])";
        const rows = kb
          .map(
            (row) =>
              "[" +
              row
                .map((btn) => {
                  const actionValue = btn.url ? `"${escapeStr(btn.url)}"` : `"${escapeStr(btn.callback_data || "")}"`;
                  return `Markup.button.${btn.url ? "url" : "callback"}("${escapeStr(btn.text)}", ${actionValue})`;
                })
                .join(", ") +
              "]"
          )
          .join(",\n    ");
        return `Markup.inlineKeyboard([\n    ${rows}\n  ])`;
      };

      const captionRaw = "text" in payload ? payload.text : payload.caption || "";
      const mediaRaw = "photo" in payload ? payload.photo : "video" in payload ? payload.video : null;
      const caption = escapeStr(captionRaw || "");
      const media = mediaRaw ? escapeStr(mediaRaw) : null;
      const parseMode = payload.parse_mode;

      if (framework === "python-telegram-bot") {
        const pythonKeyboard = kb.length ? `[\n${buildPythonInlineKeyboard()}\n    ]` : "[]";

        return `from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup\nfrom telegram.ext import ApplicationBuilder, CommandHandler, CallbackQueryHandler, ContextTypes\n\nasync def start(update: Update, context: ContextTypes.DEFAULT_TYPE):\n    keyboard = ${pythonKeyboard}\n    markup = InlineKeyboardMarkup(keyboard)\n    ${media ? `await update.message.reply_${messageType === "photo" ? "photo" : "video"}("${media}", caption="${caption}", parse_mode="${parseMode}", reply_markup=markup)` : `await update.message.reply_text("${caption}", parse_mode="${parseMode}", reply_markup=markup)`}\n\nasync def on_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):\n    query = update.callback_query\n    await query.answer()\n    await query.edit_message_text(text="Received: " + (query.data or ""))\n\napp = ApplicationBuilder().token("<BOT_TOKEN>").build()\napp.add_handler(CommandHandler("start", start))\napp.add_handler(CallbackQueryHandler(on_callback))\napp.run_polling()\n`;
      }

      if (framework === "aiogram") {
        const aiogramKeyboard = kb.length ? `InlineKeyboardMarkup(inline_keyboard=[\n${buildPythonInlineKeyboard()}\n    ])` : "InlineKeyboardMarkup(inline_keyboard=[])";

        return `from aiogram import Bot, Dispatcher, F\nfrom aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, Message, CallbackQuery\nfrom aiogram.filters import Command\nfrom aiogram.enums import ParseMode\nfrom aiogram import Router\n\nrouter = Router()\n\n@router.message(Command("start"))\nasync def cmd_start(message: Message):\n    kb = ${aiogramKeyboard}\n    ${media ? `await message.answer_${messageType === "photo" ? "photo" : "video"}("${media}", caption="${caption}", parse_mode=ParseMode.${parseMode === "HTML" ? "HTML" : "MARKDOWN_V2"}, reply_markup=kb)` : `await message.answer("${caption}", parse_mode=ParseMode.${parseMode === "HTML" ? "HTML" : "MARKDOWN_V2"}, reply_markup=kb)`}\n\n@router.callback_query()\nasync def on_callback(query: CallbackQuery):\n    await query.answer("Received: " + (query.data or ""))\n\nbot = Bot(token="<BOT_TOKEN>", parse_mode=ParseMode.${parseMode === "HTML" ? "HTML" : "MARKDOWN_V2"})\ndp = Dispatcher()\ndp.include_router(router)\ndp.run_polling(bot)\n`;
      }

      const telegrafKeyboard = buildTelegrafKeyboard();

      return `const { Telegraf, Markup } = require("telegraf");\nconst bot = new Telegraf(process.env.BOT_TOKEN);\n\nbot.start((ctx) => {\n  const keyboard = ${telegrafKeyboard};\n  ${media ? `ctx.replyWith${messageType === "photo" ? "Photo" : "Video"}("${media}", { caption: "${caption}", parse_mode: "${parseMode}", reply_markup: keyboard.reply_markup });` : `ctx.reply("${caption}", { parse_mode: "${parseMode}", reply_markup: keyboard.reply_markup });`}\n});\n\nbot.on("callback_query", (ctx) => ctx.answerCbQuery("Received: " + (ctx.callbackQuery?.data || "")));\n\nbot.launch();\n`;
    },
    [convertToTelegramFormat, messageType]
  );

  const codegenOutput = useMemo(() => generateCode(codegenFramework), [generateCode, codegenFramework]);

  const handleCopyCodegen = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(codegenOutput);
      toast.success("代码已复制");
    } catch (e) {
      toast.error("复制失败");
    }
  }, [codegenOutput]);

  return {
    codegenFramework,
    setCodegenFramework,
    codegenOutput,
    handleCopyCodegen,
  };
};
