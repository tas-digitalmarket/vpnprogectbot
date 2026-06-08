const fs = require("fs");
const http = require("http");
const path = require("path");

const root = process.env.BOT_ROOT || __dirname;
const envPath = path.join(root, ".env");
const statePath = path.join(root, "tasks.json");

function loadEnv() {
  const env = {};
  const text = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    env[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return env;
}

const env = loadEnv();
const token = process.env.TELEGRAM_BOT_TOKEN || env.TELEGRAM_BOT_TOKEN;
if (!token || token === "put-your-bot-token-here") {
  throw new Error("TELEGRAM_BOT_TOKEN is missing.");
}

const admins = new Set(
  (process.env.ADMIN_USER_IDS || env.ADMIN_USER_IDS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
);

const reminderMinutes = (process.env.REMINDER_MINUTES || env.REMINDER_MINUTES || "1440,180,30,0")
  .split(",")
  .map((item) => Number(item.trim()))
  .filter((item) => Number.isFinite(item));

function loadState() {
  if (!fs.existsSync(statePath)) return { nextId: 1, offset: 0, tasks: [] };
  return JSON.parse(fs.readFileSync(statePath, "utf8"));
}

function saveState() {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
}

const state = loadState();
const port = Number(process.env.PORT || env.PORT || 3000);
const webhookBaseUrl = process.env.WEBHOOK_URL || env.WEBHOOK_URL || process.env.RENDER_EXTERNAL_URL || "";
const webhookPath = process.env.WEBHOOK_PATH || env.WEBHOOK_PATH || "/webhook";
const useWebhook = Boolean(webhookBaseUrl);

async function api(method, params = {}) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await response.json();
  if (!data.ok) throw new Error(`${method} failed: ${data.description || "unknown error"}`);
  return data.result;
}

function isAdmin(userId) {
  return admins.size === 0 || admins.has(String(userId));
}

function parseDueAt(value) {
  const now = Date.now();
  const trimmed = value.trim();
  const amount = Number(trimmed.slice(0, -1));
  if (trimmed.endsWith("m")) return new Date(now + amount * 60 * 1000);
  if (trimmed.endsWith("h")) return new Date(now + amount * 60 * 60 * 1000);
  if (trimmed.endsWith("d")) return new Date(now + amount * 24 * 60 * 60 * 1000);
  const parsed = new Date(trimmed.replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) throw new Error("bad due date");
  return parsed;
}

function statusLabel(status) {
  return {
    pending: "Pending",
    started: "Started",
    blocked: "Needs help",
    done: "Done",
    cancelled: "Cancelled",
  }[status] || status;
}

function progress(task, now = new Date()) {
  const start = new Date(task.startAt).getTime();
  const due = new Date(task.dueAt).getTime();
  const total = Math.max(due - start, 1);
  const elapsed = Math.max(now.getTime() - start, 0);
  const percent = Math.min(Math.floor((elapsed / total) * 100), 100);
  const filled = Math.min(Math.round(percent / 10), 10);
  return { bar: "#".repeat(filled) + "-".repeat(10 - filled), percent };
}

function remaining(task, now = new Date()) {
  let seconds = Math.floor((new Date(task.dueAt).getTime() - now.getTime()) / 1000);
  if (seconds <= 0) {
    seconds = Math.abs(seconds);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `Deadline passed; overdue by ${hours}h ${minutes}m`;
  }
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${days}d ${hours}h remaining`;
  return `${hours}h ${minutes}m remaining`;
}

function taskText(task) {
  const { bar, percent } = progress(task);
  const due = new Date(task.dueAt).toLocaleString("en-US");
  const description = task.description ? `\n\nDescription: ${task.description}` : "";
  return (
    `Task #${task.id}: ${task.title}\n` +
    `Assignee: ${task.assigneeLabel}\n` +
    `Deadline: ${due}\n` +
    `Status: ${statusLabel(task.status)}\n\n` +
    `[${bar}] ${percent}%\n` +
    `${remaining(task)}${description}`
  );
}

function keyboard(task) {
  return {
    inline_keyboard: [
      [
        { text: "Start", callback_data: `status:${task.id}:started` },
        { text: "Done", callback_data: `status:${task.id}:done` },
      ],
      [
        { text: "Need help", callback_data: `status:${task.id}:blocked` },
        { text: "Cancel", callback_data: `status:${task.id}:cancelled` },
      ],
      [{ text: "Check time left", callback_data: `check:${task.id}` }],
    ],
  };
}

function helpText() {
  return (
    "Hi. I manage team tasks and deadlines.\n\n" +
    "Create a task:\n" +
    "/newtask Title | assignee numeric chat id | deadline | optional description\n\n" +
    "Example:\n" +
    "/newtask Login page design | 123456789 | 6h | Mobile and desktop version\n\n" +
    "Deadline formats: 30m, 6h, 2d, or 2026-06-10 18:00\n\n" +
    "/mytasks shows your active tasks\n" +
    "/tasks shows all active tasks for admins"
  );
}

async function sendMessage(chatId, text, replyMarkup) {
  return api("sendMessage", { chat_id: chatId, text, reply_markup: replyMarkup });
}

async function handleMessage(message) {
  const text = message.text || "";
  const chatId = message.chat.id;
  const userId = message.from?.id;

  if (text.startsWith("/start") || text.startsWith("/help")) {
    await sendMessage(chatId, helpText());
    return;
  }

  if (text.startsWith("/newtask")) {
    if (!isAdmin(userId)) {
      await sendMessage(chatId, "Only an admin can create a task.");
      return;
    }

    const parts = text.replace("/newtask", "").trim().split("|").map((part) => part.trim());
    if (parts.length < 3) {
      await sendMessage(chatId, helpText());
      return;
    }

    try {
      const dueAt = parseDueAt(parts[2]);
      const assigneeChatId = Number(parts[1]);
      const task = {
        id: state.nextId++,
        title: parts[0],
        assigneeChatId,
        assigneeLabel: String(assigneeChatId),
        creatorChatId: chatId,
        startAt: new Date().toISOString(),
        dueAt: dueAt.toISOString(),
        status: "pending",
        description: parts[3] || "",
        reminders: {},
      };
      const sent = await sendMessage(assigneeChatId, taskText(task), keyboard(task));
      task.messageChatId = sent.chat.id;
      task.messageId = sent.message_id;
      state.tasks.push(task);
      saveState();
      await sendMessage(chatId, `Task #${task.id} was created and sent to the assignee.`);
    } catch (error) {
      await sendMessage(chatId, "Task was not created. Make sure the assignee has already sent /start to the bot and the deadline format is valid.");
      console.error(error);
    }
    return;
  }

  if (text.startsWith("/mytasks")) {
    const tasks = state.tasks.filter((task) => task.assigneeChatId === chatId && !["done", "cancelled"].includes(task.status));
    await sendMessage(chatId, tasks.length ? tasks.map(taskText).join("\n\n") : "You have no active tasks.");
    return;
  }

  if (text.startsWith("/tasks")) {
    if (!isAdmin(userId)) {
      await sendMessage(chatId, "Only an admin can view all active tasks.");
      return;
    }
    const tasks = state.tasks.filter((task) => !["done", "cancelled"].includes(task.status));
    await sendMessage(chatId, tasks.length ? tasks.map(taskText).join("\n\n") : "There are no active tasks.");
  }
}

async function handleCallback(query) {
  const [kind, taskIdText, status] = query.data.split(":");
  const task = state.tasks.find((item) => item.id === Number(taskIdText));
  if (!task) return;

  if (query.from.id !== task.assigneeChatId && !isAdmin(query.from.id)) {
    await api("answerCallbackQuery", {
      callback_query_id: query.id,
      text: "This task is not assigned to you.",
      show_alert: true,
    });
    return;
  }

  if (kind === "check") {
    await api("answerCallbackQuery", { callback_query_id: query.id, text: "Time updated." });
    await sendMessage(query.message.chat.id, taskText(task), keyboard(task));
    return;
  }

  if (kind !== "status") return;

  task.status = status;
  saveState();
  await api("answerCallbackQuery", { callback_query_id: query.id });
  await api("editMessageText", {
    chat_id: query.message.chat.id,
    message_id: query.message.message_id,
    text: taskText(task),
    reply_markup: keyboard(task),
  });
  if (["done", "blocked", "cancelled"].includes(status)) {
    await sendMessage(task.creatorChatId, `Task #${task.id} status changed.\n\n${taskText(task)}`);
  }
}

async function handleUpdate(update) {
  if (update.message) await handleMessage(update.message);
  if (update.callback_query) await handleCallback(update.callback_query);
  if (typeof update.update_id === "number") state.offset = Math.max(state.offset || 0, update.update_id + 1);
  saveState();
}

async function poll() {
  try {
    const updates = await api("getUpdates", { offset: state.offset, timeout: 25, allowed_updates: ["message", "callback_query"] });
    for (const update of updates) await handleUpdate(update);
  } catch (error) {
    console.error(error.message);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  } finally {
    setImmediate(poll);
  }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        request.destroy();
        reject(new Error("request body too large"));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

async function startWebhookServer() {
  const url = `${webhookBaseUrl.replace(/\/$/, "")}${webhookPath}`;
  await api("deleteWebhook", { drop_pending_updates: false });
  await api("setWebhook", { url, allowed_updates: ["message", "callback_query"] });

  const server = http.createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/") {
        response.writeHead(200, { "Content-Type": "text/plain" });
        response.end("Telegram task bot is running.");
        return;
      }
      if (request.method === "GET" && request.url === "/health") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
        return;
      }
      if (request.method === "POST" && request.url === webhookPath) {
        const body = await readBody(request);
        await handleUpdate(JSON.parse(body || "{}"));
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
        return;
      }
      response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("Not found");
    } catch (error) {
      console.error(error);
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: false }));
    }
  });

  server.listen(port, () => {
    console.log(`Webhook server listening on port ${port}`);
    console.log(`Telegram webhook set to ${url}`);
  });
}

async function sendReminders() {
  const now = new Date();
  for (const task of state.tasks.filter((item) => !["done", "cancelled"].includes(item.status))) {
    const minutesLeft = Math.floor((new Date(task.dueAt).getTime() - now.getTime()) / 60000);
    for (const minute of reminderMinutes) {
      if (minutesLeft <= minute && !task.reminders[String(minute)]) {
        const { bar, percent } = progress(task, now);
        await sendMessage(task.assigneeChatId, `Task reminder #${task.id}: ${task.title}\n[${bar}] ${percent}%\n${remaining(task, now)}`);
        task.reminders[String(minute)] = true;
        if (minute === 0) await sendMessage(task.creatorChatId, `Task #${task.id} has reached its deadline.\n\n${taskText(task)}`);
        saveState();
      }
    }
  }
}

console.log("Telegram task bot is running.");
if (useWebhook) {
  startWebhookServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else {
  poll();
}
setInterval(sendReminders, 60 * 1000);
