/**
 * NosaBot — Nosana Agent Builder Plugin
 */

import {
  type Plugin,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
} from "@elizaos/core";
import * as fs from "fs";
import * as path from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Task { id: string; text: string; completed: boolean; createdAt: string; completedAt?: string; }
interface Note { id: string; title: string; content: string; createdAt: string; }

// ─── Persistence ──────────────────────────────────────────────────────────────

const DATA_DIR = process.env.SQLITE_DATA_DIR || "./data";
const TASKS_FILE = path.join(DATA_DIR, "tasks.json");
const NOTES_FILE = path.join(DATA_DIR, "notes.json");

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function loadTasks(): Task[] { ensureDir(); try { return fs.existsSync(TASKS_FILE) ? JSON.parse(fs.readFileSync(TASKS_FILE, "utf-8")) : []; } catch { return []; } }
function saveTasks(t: Task[]) { ensureDir(); fs.writeFileSync(TASKS_FILE, JSON.stringify(t, null, 2)); }
function loadNotes(): Note[] { ensureDir(); try { return fs.existsSync(NOTES_FILE) ? JSON.parse(fs.readFileSync(NOTES_FILE, "utf-8")) : []; } catch { return []; } }
function saveNotes(n: Note[]) { ensureDir(); fs.writeFileSync(NOTES_FILE, JSON.stringify(n, null, 2)); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

// ─── Productivity Actions ─────────────────────────────────────────────────────

const addTaskAction = {
  name: "ADD_TASK",
  description: "Add a new task to the user's task list.",
  similes: ["CREATE_TASK", "NEW_TASK", "TODO"],
  validate: async (_r: IAgentRuntime, msg: Memory) => {
    const t = msg.content.text?.toLowerCase() ?? "";
    return /\badd\b.*\btask\b/.test(t) || /\bnew task\b/.test(t) || /\bremind me to\b/.test(t) || /\btodo[:\s]/.test(t);
  },
  handler: async (_r: IAgentRuntime, msg: Memory, _s: State, _o: unknown, cb: HandlerCallback) => {
    const raw = msg.content.text ?? "";
    const text = raw.replace(/^(add|create|new)\s+(a\s+)?task[:\s]+/i, "").replace(/^remind me to\s+/i, "").replace(/^todo[:\s]+/i, "").trim() || raw.trim();
    const tasks = loadTasks();
    tasks.push({ id: uid(), text, completed: false, createdAt: new Date().toISOString() });
    saveTasks(tasks);
    const active = tasks.filter(t => !t.completed).length;
    await cb({ text: `✅ Task added: "${text}"\n\nYou have ${active} active task${active !== 1 ? "s" : ""}. Say "list tasks" to see them.`, action: "ADD_TASK" });
    return true;
  },
  examples: [] as never[],
};

const listTasksAction = {
  name: "LIST_TASKS",
  description: "Show the user's task list.",
  similes: ["SHOW_TASKS", "MY_TASKS"],
  validate: async (_r: IAgentRuntime, msg: Memory) => {
    const t = msg.content.text?.toLowerCase() ?? "";
    return /\b(list|show|view|see)\b.*\btasks?\b/.test(t) || /\bmy tasks?\b/.test(t);
  },
  handler: async (_r: IAgentRuntime, _m: Memory, _s: State, _o: unknown, cb: HandlerCallback) => {
    const tasks = loadTasks();
    if (!tasks.length) { await cb({ text: '📋 No tasks yet. Add one: "Add task: your task"', action: "LIST_TASKS" }); return true; }
    const active = tasks.filter(t => !t.completed);
    const done = tasks.filter(t => t.completed);
    let res = "📋 **Your Tasks:**\n\n";
    if (active.length) { res += "**Active:**\n"; active.forEach((t, i) => { res += `${i + 1}. ☐ ${t.text}\n`; }); }
    else res += "**Active:** *(none — great job!)*\n";
    if (done.length) { res += `\n**Completed (${done.length}):**\n`; done.slice(-5).forEach(t => { res += `• ✅ ${t.text}\n`; }); }
    await cb({ text: res.trim(), action: "LIST_TASKS" });
    return true;
  },
  examples: [] as never[],
};

const completeTaskAction = {
  name: "COMPLETE_TASK",
  description: "Mark a task as done.",
  similes: ["DONE_TASK", "FINISH_TASK"],
  validate: async (_r: IAgentRuntime, msg: Memory) => {
    const t = msg.content.text?.toLowerCase() ?? "";
    return /\b(complete|done|finished?|mark)\b/.test(t) && /\btask\b/.test(t);
  },
  handler: async (_r: IAgentRuntime, msg: Memory, _s: State, _o: unknown, cb: HandlerCallback) => {
    const tasks = loadTasks();
    const active = tasks.filter(t => !t.completed);
    const text = msg.content.text ?? "";
    let target: Task | undefined;
    const num = text.match(/\b(\d+)\b/);
    if (num) { const i = parseInt(num[1], 10) - 1; if (i >= 0 && i < active.length) target = active[i]; }
    if (!target) { const s = text.toLowerCase().replace(/\b(complete|done|finished?|mark|task)\b/g, "").trim(); target = active.find(t => t.text.toLowerCase().includes(s)); }
    if (!target) { await cb({ text: active.length ? `Active tasks:\n${active.map((t, i) => `${i + 1}. ${t.text}`).join("\n")}\n\nTry "complete task 1"` : "No active tasks!" }); return true; }
    const i = tasks.findIndex(t => t.id === target!.id);
    tasks[i].completed = true; tasks[i].completedAt = new Date().toISOString();
    saveTasks(tasks);
    const rem = tasks.filter(t => !t.completed).length;
    await cb({ text: `✅ Marked "${target.text}" complete! ${rem} task${rem !== 1 ? "s" : ""} remaining.`, action: "COMPLETE_TASK" });
    return true;
  },
  examples: [] as never[],
};

const saveNoteAction = {
  name: "SAVE_NOTE",
  description: "Save a note for the user.",
  similes: ["CREATE_NOTE", "WRITE_NOTE"],
  validate: async (_r: IAgentRuntime, msg: Memory) => {
    const t = msg.content.text?.toLowerCase() ?? "";
    return /\bsave (a )?note\b/.test(t) || /\bnote[:\s]+\S/.test(t) || /\bjot.*down\b/.test(t) || /\bremember that\b/.test(t);
  },
  handler: async (_r: IAgentRuntime, msg: Memory, _s: State, _o: unknown, cb: HandlerCallback) => {
    const raw = msg.content.text ?? "";
    const content = raw.replace(/^save (a )?note[:\s]+/i, "").replace(/^note[:\s]+/i, "").replace(/^jot.*down[:\s]+/i, "").replace(/^remember that\s+/i, "").trim() || raw.trim();
    const words = content.split(/\s+/);
    const title = words.slice(0, 7).join(" ") + (words.length > 7 ? "…" : "");
    const notes = loadNotes();
    notes.push({ id: uid(), title, content, createdAt: new Date().toISOString() });
    saveNotes(notes);
    await cb({ text: `📝 Note saved: "${title}"\n\n${notes.length} note${notes.length !== 1 ? "s" : ""} total.`, action: "SAVE_NOTE" });
    return true;
  },
  examples: [] as never[],
};

const listNotesAction = {
  name: "LIST_NOTES",
  description: "Show all saved notes.",
  similes: ["SHOW_NOTES", "MY_NOTES"],
  validate: async (_r: IAgentRuntime, msg: Memory) => {
    const t = msg.content.text?.toLowerCase() ?? "";
    return /\b(list|show|view|see)\b.*\bnotes?\b/.test(t) || /\bmy notes?\b/.test(t);
  },
  handler: async (_r: IAgentRuntime, _m: Memory, _s: State, _o: unknown, cb: HandlerCallback) => {
    const notes = loadNotes();
    if (!notes.length) { await cb({ text: '📓 No notes yet. Save one: "Note: your idea"', action: "LIST_NOTES" }); return true; }
    let res = `📓 **Your Notes** (${notes.length} total):\n\n`;
    notes.slice(-10).forEach((n, i) => { res += `**${i + 1}. ${n.title}** *(${new Date(n.createdAt).toLocaleDateString()})*\n${n.content}\n\n`; });
    await cb({ text: res.trim(), action: "LIST_NOTES" });
    return true;
  },
  examples: [] as never[],
};

// ─── Agent Builder Actions ────────────────────────────────────────────────────

const NOSANA_INFERENCE = "https://4ksj3tve5bazqwkuyqdhwdpcar4yutcuxphwhckrdxmu.node.k8s.prd.nos.ci/v1";
const NOSANA_EMBEDDING = "https://4yiccatpyxx773jtewo5ccwhw1s2hezq5pehndb6fcfq.node.k8s.prd.nos.ci/v1";

function buildCharacter(request: string): Record<string, unknown> {
  const words = request.replace(/[^a-zA-Z ]/g, "").trim().split(/\s+/).filter(Boolean);
  const name = words.slice(0, 2).map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join("") + "Bot";
  const username = name.toLowerCase();
  const topics = words.slice(0, 8).map(w => w.toLowerCase());

  return {
    name,
    username,
    plugins: ["@elizaos/plugin-bootstrap", "@elizaos/plugin-openai"],
    clients: [],
    modelProvider: "openai",
    settings: { model: "Qwen/Qwen3.5-4B", secrets: {} },
    system: `You are ${name}, an AI agent specialized in: ${request}. You are helpful, accurate, and concise. Always provide actionable information specific to your domain. You run on Nosana's decentralized GPU network, powered by open-source AI.`,
    bio: [
      `${name} is a specialized AI agent focused on ${request}.`,
      "Runs on Nosana's decentralized GPU network — no Big Tech required.",
      "Built with ElizaOS, the leading framework for autonomous AI agents.",
      "Privacy-first: your data stays on infrastructure you control.",
    ],
    lore: [
      `${name} was built to make ${request} accessible and automated.`,
      "Deployed on Nosana's decentralized GPU network for censorship-resistant AI.",
      "Powered by open-source Qwen3.5 — no proprietary API keys needed.",
    ],
    knowledge: [
      `Core domain: ${request}`,
      "Nosana provides decentralized GPU compute built on Solana.",
      "ElizaOS enables autonomous AI agents with custom plugins and actions.",
      "Add domain-specific knowledge facts here to improve accuracy.",
    ],
    messageExamples: [
      [
        { user: "{{user1}}", content: { text: "What can you help me with?" } },
        { user: name, content: { text: `I specialize in ${request}. Ask me anything about it and I'll give you clear, actionable answers. What would you like to know?` } },
      ],
    ],
    postExamples: [
      `Just automated a ${request} workflow using decentralized AI on @nosana_ci 🚀 #Nosana #ElizaOS`,
    ],
    topics,
    adjectives: ["helpful", "accurate", "concise", "reliable", "knowledgeable"],
    style: {
      all: ["Be concise and accurate", "Use markdown for structure", "Provide actionable information"],
      chat: ["Be conversational", "Ask clarifying questions when needed"],
      post: ["Be enthusiastic", "Tag @nosana_ci and @elizaos"],
    },
  };
}

const generateCharacterAction = {
  name: "GENERATE_CHARACTER",
  description: "Generate a complete ElizaOS character.json for a new AI agent based on the user's description.",
  similes: ["BUILD_AGENT", "CREATE_AGENT", "NEW_AGENT", "DESIGN_AGENT"],
  validate: async (_r: IAgentRuntime, msg: Memory) => {
    const t = msg.content.text?.toLowerCase() ?? "";
    return /\b(build|create|design|make|generate)\b.*\b(agent|bot|character)\b/.test(t) ||
           /\bagent\b.*\b(that|who|which)\b/.test(t) || /\bnew (ai )?agent\b/.test(t) || /\bcharacter\.json\b/.test(t);
  },
  handler: async (_r: IAgentRuntime, msg: Memory, _s: State, _o: unknown, cb: HandlerCallback) => {
    const request = (msg.content.text ?? "").replace(/\b(build|create|design|make|generate)\b.*?\b(me\s+)?(an?\s+)?agent\b/i, "").replace(/\bthat\b/i, "").trim() || msg.content.text ?? "general purpose assistant";
    const character = buildCharacter(request);
    const json = JSON.stringify(character, null, 2);
    await cb({
      text: `✅ **ElizaOS Character File Generated!**\n\n\`\`\`json\n${json}\n\`\`\`\n\n**Next steps:**\n1. Download and save as \`characters/${character.username}.character.json\`\n2. Run: \`elizaos start --character ./characters/${character.username}.character.json\`\n3. Ask me to **"generate Nosana job definition"** to get the deployment config\n\nWant me to generate the Nosana deployment config for this agent?`,
      action: "GENERATE_CHARACTER",
    });
    return true;
  },
  examples: [] as never[],
};

const generateJobDefAction = {
  name: "GENERATE_JOB_DEF",
  description: "Generate a Nosana job definition JSON to deploy an ElizaOS agent.",
  similes: ["NOSANA_JOB", "DEPLOY_CONFIG", "JOB_DEFINITION", "DEPLOY_AGENT"],
  validate: async (_r: IAgentRuntime, msg: Memory) => {
    const t = msg.content.text?.toLowerCase() ?? "";
    return /\bjob (def|definition|config)\b/.test(t) || /\bdeploy (to )?nosana\b/.test(t) ||
           /\bnosana\b.*\b(deploy|job|config)\b/.test(t) || /\bhow (to |do i )?deploy\b/.test(t);
  },
  handler: async (_r: IAgentRuntime, msg: Memory, _s: State, _o: unknown, cb: HandlerCallback) => {
    const text = msg.content.text ?? "";
    const imgMatch = text.match(/([a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*:[a-z0-9._-]+)/i);
    const image = imgMatch ? imgMatch[1] : "yourusername/my-eliza-agent:latest";
    const jobDef = {
      ops: [{
        id: "eliza-agent",
        args: {
          image, expose: 3000,
          env: {
            OPENAI_API_KEY: "nosana", OPENAI_API_URL: NOSANA_INFERENCE,
            OPENAI_EMBEDDING_URL: NOSANA_EMBEDDING, OPENAI_EMBEDDING_API_KEY: "nosana",
            OPENAI_EMBEDDING_MODEL: "Qwen3-Embedding-0.6B", OPENAI_EMBEDDING_DIMENSIONS: "1024",
            MODEL_NAME: "Qwen/Qwen3.5-4B", SERVER_PORT: "3000",
            NODE_ENV: "production", ELIZAOS_TELEMETRY_DISABLED: "true",
          },
        },
        execution: { group: "run" }, type: "container/run",
      }],
      version: "0.1",
    };
    await cb({
      text: `🚀 **Nosana Job Definition**\n\n\`\`\`json\n${JSON.stringify(jobDef, null, 2)}\n\`\`\`\n\n**Deploy steps:**\n1. \`docker build -t ${image} .\`\n2. \`docker push ${image}\`\n3. Save JSON above as \`job.json\`\n4. \`nosana job post --file job.json --market nvidia-3090\`\n\nOr paste into [Nosana Dashboard](https://app.nosana.io) → Post Job.`,
      action: "GENERATE_JOB_DEF",
    });
    return true;
  },
  examples: [] as never[],
};

// ─── Nosana Network Actions ───────────────────────────────────────────────────

const nosanaJobStatusAction = {
  name: "NOSANA_JOB_STATUS",
  description: "Check the status of a Nosana job by its address.",
  similes: ["CHECK_JOB", "JOB_STATUS", "NOSANA_STATUS"],
  validate: async (_r: IAgentRuntime, msg: Memory) => {
    const t = msg.content.text?.toLowerCase() ?? "";
    return /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/.test(msg.content.text ?? "") && /\b(job|status|check|nosana)\b/.test(t);
  },
  handler: async (_r: IAgentRuntime, msg: Memory, _s: State, _o: unknown, cb: HandlerCallback) => {
    const idMatch = (msg.content.text ?? "").match(/\b([1-9A-HJ-NP-Za-km-z]{32,44})\b/);
    if (!idMatch) { await cb({ text: "Please provide a Nosana job address to check." }); return true; }
    const jobId = idMatch[1];
    try {
      const res = await fetch(`https://dashboard.k8s.prd.nos.ci/api/jobs/${jobId}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const job = await res.json() as Record<string, unknown>;
      const icons: Record<string, string> = { RUNNING: "🟡", COMPLETED: "✅", FAILED: "❌", QUEUED: "⏳", STOPPED: "🔴" };
      const icon = icons[String(job.status ?? "")] ?? "❓";
      await cb({ text: `${icon} **Job ${jobId.slice(0, 8)}…**\n\n• **Status:** ${job.status ?? "Unknown"}\n• **Created:** ${job.createdAt ? new Date(String(job.createdAt)).toLocaleString() : "N/A"}\n• **Market:** ${job.market ?? "N/A"}\n\n🔗 [Explorer](https://explorer.nosana.io/jobs/${jobId})`, action: "NOSANA_JOB_STATUS" });
    } catch {
      await cb({ text: `Check your job at:\n🔗 https://explorer.nosana.io/jobs/${jobId}\n\nOr run: \`nosana job get ${jobId}\``, action: "NOSANA_JOB_STATUS" });
    }
    return true;
  },
  examples: [] as never[],
};

const nosanaStatsAction = {
  name: "NOSANA_NETWORK_STATS",
  description: "Show Nosana network statistics and GPU availability.",
  similes: ["NOSANA_STATS", "NETWORK_STATS", "GPU_STATS"],
  validate: async (_r: IAgentRuntime, msg: Memory) => {
    const t = msg.content.text?.toLowerCase() ?? "";
    return /\bnosana\b.*\b(stats?|network|gpu|nodes?|pricing)\b/.test(t) || /\bnosana network\b/.test(t) || /\bhow many (gpus?|nodes?)\b/.test(t);
  },
  handler: async (_r: IAgentRuntime, _m: Memory, _s: State, _o: unknown, cb: HandlerCallback) => {
    try {
      const res = await fetch("https://dashboard.k8s.prd.nos.ci/api/nodes/summary", { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error();
      const d = await res.json() as Record<string, unknown>;
      await cb({ text: `📊 **Nosana Network — Live Stats**\n\n• **Active Nodes:** ${d.active ?? d.available ?? "N/A"}\n• **Total Nodes:** ${d.total ?? d.count ?? "N/A"}\n• **Jobs Completed:** ${d.completedJobs ?? d.jobs ?? "N/A"}\n• **Blockchain:** Solana Mainnet\n• **Token:** NOS\n\n🔗 [Dashboard](https://app.nosana.io) · [Explorer](https://explorer.nosana.io)`, action: "NOSANA_NETWORK_STATS" });
    } catch {
      await cb({ text: `📊 **Nosana Network**\n\n• **Blockchain:** Solana Mainnet\n• **Token:** NOS\n• **GPU Types:** RTX 3090, RTX 4090, A4000, A100, H100\n• **Cost:** 60-90% cheaper than AWS/GCP\n• **Key feature:** Decentralized, censorship-resistant compute\n\n🔗 [Dashboard](https://app.nosana.io) · [Docs](https://docs.nosana.io)`, action: "NOSANA_NETWORK_STATS" });
    }
    return true;
  },
  examples: [] as never[],
};

// ─── Provider ─────────────────────────────────────────────────────────────────

const productivityProvider = {
  name: "PRODUCTIVITY_CONTEXT",
  description: "Injects task/note summary as context.",
  get: async (_r: IAgentRuntime, _m: Memory) => {
    const tasks = loadTasks(); const notes = loadNotes();
    const active = tasks.filter(t => !t.completed);
    return `[Context] Active tasks: ${active.length}. Notes: ${notes.length}.\n${active.slice(0, 3).map(t => `- ${t.text}`).join("\n")}`;
  },
};

// ─── Export ───────────────────────────────────────────────────────────────────

export const customPlugin: Plugin = {
  name: "nosana-agent-builder-plugin",
  description: "NosaBot full plugin: productivity, agent generation, and Nosana integration.",
  actions: [addTaskAction, listTasksAction, completeTaskAction, saveNoteAction, listNotesAction, generateCharacterAction, generateJobDefAction, nosanaJobStatusAction, nosanaStatsAction],
  providers: [productivityProvider],
  evaluators: [],
};

export default customPlugin;
