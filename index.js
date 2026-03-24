require("dotenv").config();
const { readFileSync } = require("fs");
const { join } = require("path");
const { Telegraf } = require("telegraf");
const { Client } = require("ssh2");

// --- Config ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const ALLOWED_USERS = (process.env.ALLOWED_USERS || "").split(",").map(Number);
const SSH_HOST = process.env.SSH_HOST; // ssh.aiaihoplava.xyz
const SSH_PORT = parseInt(process.env.SSH_PORT || "22", 10);
const SSH_USER = process.env.SSH_USER; // artsrun.hakobyan
const SSH_KEY_PATH = process.env.SSH_KEY_PATH || join(require("os").homedir(), ".ssh", "jan_claude_bot");
let SSH_PRIVATE_KEY = process.env.SSH_PRIVATE_KEY;
if (!SSH_PRIVATE_KEY) {
  try {
    SSH_PRIVATE_KEY = readFileSync(SSH_KEY_PATH, "utf8");
    console.log(`🔑 Loaded SSH key from ${SSH_KEY_PATH}`);
  } catch { /* handled by guard below */ }
}
const WORK_DIR = process.env.WORK_DIR || "/c/Users/artsrun.hakobyan/source";

// --- Guards ---
if (!BOT_TOKEN) throw new Error("BOT_TOKEN required");
if (!SSH_HOST) console.warn("⚠️  SSH_HOST not set — SSH commands will fail");
if (!SSH_PRIVATE_KEY) console.warn("⚠️  SSH_PRIVATE_KEY not set — SSH commands will fail");

const bot = new Telegraf(BOT_TOKEN);

// Auth middleware — /whoami is always allowed
bot.command("whoami", (ctx) => {
  ctx.reply(`Your Telegram user ID: \`${ctx.from.id}\``, {
    parse_mode: "Markdown",
  });
});

bot.use((ctx, next) => {
  if (ALLOWED_USERS.length && !ALLOWED_USERS.includes(ctx.from?.id)) {
    return ctx.reply("Unauthorized. Send /whoami to get your user ID.");
  }
  return next();
});

// --- SSH exec helper ---
function sshExec(command, timeoutMs = 120_000) {
  if (!SSH_HOST || !SSH_PRIVATE_KEY) {
    return Promise.reject(new Error("SSH not configured — set SSH_HOST and SSH_PRIVATE_KEY in .env"));
  }
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      conn.end();
      reject(new Error(`SSH command timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    conn.on("ready", () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          conn.end();
          return reject(err);
        }
        stream.on("data", (data) => (stdout += data.toString()));
        stream.stderr.on("data", (data) => (stderr += data.toString()));
        stream.on("close", (code) => {
          clearTimeout(timer);
          conn.end();
          resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code });
        });
      });
    });

    conn.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    conn.connect({
      host: SSH_HOST,
      port: SSH_PORT,
      username: SSH_USER,
      privateKey: SSH_PRIVATE_KEY,
      // cloudflared tunnel handles the transport,
      // so we connect directly to the hostname
    });
  });
}

// --- Telegram message chunker (4096 char limit) ---
async function sendLong(ctx, text) {
  const MAX = 4000;
  if (!text) return ctx.reply("(empty output)");
  for (let i = 0; i < text.length; i += MAX) {
    await ctx.reply(`\`\`\`\n${text.slice(i, i + MAX)}\n\`\`\``, {
      parse_mode: "Markdown",
    });
  }
}

// --- Commands ---

bot.command("ping", async (ctx) => {
  try {
    const { stdout } = await sshExec("hostname");
    ctx.reply(`🏓 PONG from ${stdout}`);
  } catch (e) {
    ctx.reply(`❌ SSH failed: ${e.message}`);
  }
});

bot.command("status", async (ctx) => {
  try {
    const { stdout } = await sshExec(
      [
        "echo '=== Host ==='",
        "hostname",
        "echo '=== Git ==='",
        "git --version",
        "echo '=== Claude ==='",
        "claude --version 2>/dev/null || echo 'not found'",
        "echo '=== Uptime ==='",
        "uptime 2>/dev/null || echo N/A",
      ].join(" && ")
    );
    await sendLong(ctx, stdout);
  } catch (e) {
    ctx.reply(`❌ ${e.message}`);
  }
});

bot.command("run", async (ctx) => {
  const cmd = ctx.message.text.replace(/^\/run\s*/, "");
  if (!cmd) return ctx.reply("Usage: /run <shell command>");

  ctx.reply(`⏳ Running: \`${cmd}\``, { parse_mode: "Markdown" });
  try {
    const { stdout, stderr, code } = await sshExec(cmd, 300_000);
    const output = [
      stdout && `stdout:\n${stdout}`,
      stderr && `stderr:\n${stderr}`,
      `exit code: ${code}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    await sendLong(ctx, output);
  } catch (e) {
    ctx.reply(`❌ ${e.message}`);
  }
});

bot.command("claude", async (ctx) => {
  const prompt = ctx.message.text.replace(/^\/claude\s*/, "");
  if (!prompt) return ctx.reply("Usage: /claude <prompt for Claude Code>");

  ctx.reply(`🤖 Sending to Claude Code...`);
  try {
    const escapedPrompt = prompt.replace(/'/g, "'\\''");
    const cmd = `cd ${WORK_DIR} && claude -p '${escapedPrompt}' --output-format text 2>&1`;
    const { stdout, stderr, code } = await sshExec(cmd, 600_000);
    const output = stdout || stderr || "(no output)";
    await sendLong(ctx, output);
  } catch (e) {
    ctx.reply(`❌ ${e.message}`);
  }
});

bot.command("help", (ctx) => {
  ctx.reply(
    [
      "*Jan Claude Van Dam Bot* 🥋",
      "",
      "/ping — test SSH connectivity",
      "/status — check host environment",
      "/run <cmd> — execute shell command via SSH",
      "/claude <prompt> — run Claude Code CLI",
      "/whoami — get your Telegram user ID",
      "/help — this message",
    ].join("\n"),
    { parse_mode: "Markdown" }
  );
});

// --- Launch ---
bot.launch();
console.log("🥋 Jan Claude Van Dam Bot is running");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
