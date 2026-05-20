import TelegramBot from "node-telegram-bot-api";
import {
  defaultSummary,
  formatDateTime,
  formatDuration,
  oneLine,
  trimBlock,
} from "../helpers/notifyLogs.helpers.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

if (!token || !chatId) {
  console.log("bot token, chatId all are required.");
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: false });

export default async function notifyDeveloper(payload) {
  const {
    status,
    repo,
    branch,
    commitMessage,
    pusher,
    deliveryId,
    shouldInstall,
    startedAt,
    finishedAt,
    durationMs,
    exitCode,
    signal,
    summary,
    logExcerpt,
  } = payload;

  const icon = status === "success" ? "✅" : status === "failed" ? "❌" : "🚀";

  const lines = [
    `${icon} ${summary || defaultSummary(payload)}`,
    `Repo: ${repo ?? "-"}`,
    `Branch: ${branch ?? "-"}`,
    `Commit: ${commitMessage ? ` ${oneLine(commitMessage)}` : ""}`,
    `By: ${pusher ?? "-"}`,
    `Install: ${shouldInstall ? "yes" : "no"}`,
  ];

  if (startedAt) lines.push(`Started: ${formatDateTime(startedAt)}`);
  if (finishedAt) lines.push(`Finished: ${formatDateTime(finishedAt)}`);
  if (typeof durationMs === "number")
    lines.push(`Duration: ${formatDuration(durationMs)}`);
  if (status === "failed")
    lines.push(`Exit: code=${exitCode ?? "null"} signal=${signal ?? "null"}`);
  if (deliveryId) lines.push(`Delivery: ${deliveryId}`);

  if (logExcerpt) {
    lines.push("", "Last logs:", trimBlock(logExcerpt, 40, 3000));
  }

  await bot.sendMessage(chatId, lines.join("\n"));
}
