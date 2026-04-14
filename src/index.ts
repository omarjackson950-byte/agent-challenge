/**
 * NosaBot — Nosana Agent Builder Plugin
 *
 * Provides:
 *  1. Productivity tools  (ADD_TASK, LIST_TASKS, COMPLETE_TASK, SAVE_NOTE, LIST_NOTES)
 *  2. Agent authoring     (GENERATE_CHARACTER, GENERATE_JOB_DEF)
 *  3. Nosana integration  (NOSANA_JOB_STATUS, NOSANA_NETWORK_STATS)
 *
 * Deployed on Nosana decentralized GPU infrastructure.
 * Built with the ElizaOS framework (https://elizaos.github.io/eliza).
 */

import {
  type Plugin,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
  generateText,
  ModelClass,
} from "@elizaos/core";
import * as fs from "fs";
import * as path from "path";

// ─────────────────────────────────────────────────────────────────────────────
// Persistence helpers (tasks & notes)
// ─────────────────────────────────────────────────────────────────────────────

interface Task {
  id: string;
  text: string;
  completed: boolean;
  createdAt: string;
  completedAt?: string;
}

interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: string;
}

const DATA_DIR = process.env.SQLITE_DATA_DIR || "./data";
const TASKS_FILE = path.join(DATA_DIR, "tasks.json");
const NOTES_FILE = path.join(DATA_DIR, "notes.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadTasks(): Task[] {
  ensureDataDir();
  if (!fs.existsSync(TASKS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(TASKS_FILE, "utf-8")); } catch { return []; }
}

function saveTasks(t: Task[]) {
  ensureDataDir();
  fs.writeFileSync(TASKS_FILE, JSON.stringify(t, null, 2));
}

function loadNotes(): Note[] {
  ensureDataDir();
  if (!fs.existsSync(NOTES_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(NOTES_FILE, "utf-8")); } catch { return []; }
}

function saveNotes(n: Note[]) {
  ensureDataDir();
  fs.writeFileSync(NOTES_FILE, JSON.stringify(n, null, 2));
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

// ─────────────────────────────────────────────────────────────────────────────
// 1. Productivity actions
// ─────────────────────────────────────────────────────────────────────────────

const addTaskAction = {
  name: "ADD_TASK",
  description: "Add a new task to the user's task list.",
  similes: ["CREATE_TASK", "NEW_TASK", "TRACK_TASK", "TODO"],
  validate: async (_r: IAgentRuntime, msg: Memory) => {
    const t = msg.content.text?.toLowerCase() ?? "";
    return /\badd\b.*\btask\b/.test(t) || /\bcreate\b.*\btask\b/.test(t) ||
           /\bnew task\b/.test(t) || /\bremind me to\b/.test(t) ||
           /\bremember to\b/.test(t) || /\btodo[:\s]/.test(t);
  },
  handler: async (_r: IAgentRuntime, msg: Memory, _s: State, _o: unknown, cb: HandlerCallback) => {
    const raw = msg.content.text ?? "";
    const text = raw
      .replace(/^(add|create|new)\s+(a\s+)?task[:\s]+/i, "")
      .replace(/^remind me to\s+/i, "")
      .replace(/^remember to\s+/i, "")
      .replace(/^todo[:\s]+/i, "")
      .trim() || raw.trim();

    const tasks = loadTasks();
    tasks.push({ id: uid(), text, completed: false, createdAt: new Date().toISOString() });
    saveTasks(tasks);
    const active = tasks.filter(t => !t.completed).length;
    await cb({ text: `✅ Task added: "${text}"\n\nYou have ${active} active task${active !== 1 ? "s" : ""}. Say "list tasks" to see them.`, action: "ADD_TASK" });
    return true;
  },
  examples: [],
};

const listTasksAction = {
  name: "LIST_TASKS",
  description: "Show the user's task list.",
  similes: ["SHOW_TASKS", "GET_TASKS", "MY_TASKS"],
  validate: async (_r: IAgentRuntime, msg: Memory) => {
    const t = msg.content.text?.toLowerCase() ?? "";
    return /\b(list|show|view|see|get)\b.*\btasks?\b/.test(t) || /\bmy tasks?\b/.test(t);
  },
  handler: async (_r: IAgentRuntime, _m: Memory, _s: State, _o: unknown, cb: HandlerCallback) => {
    const tasks = loadTasks();
    if (!tasks.length) {
      await cb({ text: '📋 No tasks yet. Add one: "Add task: your task"', action: "LIST_TASKS" });
      return true;
    }
    const active = tasks.filter(t => !t.completed);
    const done = tasks.filter(t => t.completed);
    let res = "📋 **Your Tasks:**\n\n";
    if (active.length) { res += "**Active:**\n"; active.forEach((t, i) => { res += `${i + 1}. ☐ ${t.text}\n`; }); }
    else res += "**Active:** *(none — great job!)*\n";
    if (done.length) {
      res += `\n**Completed (${done.length}):**\n`;
      done.slice(-5).forEach(t => { res += `• ✅ ${t.text}\n`; });
    }
    await cb({ text: res.trim(), action: "LIST_TASKS" });
    return true;
  },
  examples: [],
};

const completeTaskAction = {
  name: "COMPLETE_TASK",
  description: "Mark a task as done.",
  similes: ["DONE_TASK", "FINISH_TASK", "MARK_DONE"],
  validate: async (_r: IAgentRuntime, msg: Memory) => {
    const t = msg.content.text?.toLowerCase() ?? "";
    return (/\b(complete|done|finish(ed)?|mark)\b/.test(t) && /\btask\b/.test(t)) ||
           /\bcompleted? task #?\d+\b/.test(t);
  },
  handler: async (_r: IAgentRuntime, msg: Memory, _s: State, _o: unknown, cb: HandlerCallback) => {
    const tasks = loadTasks();
    const active = tasks.filter(t => !t.completed);
    const text = msg.content.text ?? "";
    let target: Task | undefined;
    const num = text.match(/\b(\d+)\b/);
    if (num) { const i = parseInt(num[1], 10) - 1; if (i >= 0 && i < active.length) target = active[i]; }
    if (!target) {
      const search = text.toLowerCase().replace(/\b(complete|done|finish(ed)?|mark|task)\b/g, "").trim();
      target = active.find(t => t.text.toLowerCase().includes(search));
    }
    if (!target) {
      const list = active.length ? active.map((t, i) => `${i + 1}. ${t.text}`).join("\n") : "(none)";
      await cb({ text: `Couldn't identify that task. Active tasks:\n${list}` });
      return true;
    }
    const i = tasks.findIndex(t => t.id === target!.id);
    tasks[i].completed = true; tasks[i].completedAt = new Date().toISOString();
    saveTasks(tasks);
    const rem = tasks.filter(t => !t.completed).length;
    await cb({ text: `✅ Marked "${target.text}" complete! ${rem} task${rem !== 1 ? "s" : ""} remaining.`, action: "COMPLETE_TASK" });
    return true;
  },
  examples: [],
};

const saveNoteAction = {
  name: "SAVE_NOTE",
  description: "Save a note for the user.",
  similes: ["CREATE_NOTE", "WRITE_NOTE", "JOT_DOWN"],
  validate: async (_r: IAgentRuntime, msg: Memory) => {
    const t = msg.content.text?.toLowerCase() ?? "";
    return /\bsave (a )?note\b/.test(t) || /\bnote[:\s]+\S/.test(t) ||
           /\bjot (this )?down\b/.test(t) || /\bwrite (this )?down\b/.test(t) ||
           /\bremember that\b/.test(t) || /\btake a note\b/.test(t);
  },
  handler: async (_r: IAgentRuntime, msg: Memory, _s: State, _o: unknown, cb: HandlerCallback) => {
    const raw = msg.content.text ?? "";
    const content = raw
      .replace(/^save (a )?note[:\s]+/i, "").replace(/^note[:\s]+/i, "")
      .replace(/^note that\s+/i, "").replace(/^jot (this )?down[:\s]+/i, "")
      .replace(/^write (this )?down[:\s]+/i, "").replace(/^remember that\s+/i, "")
      .replace(/^take a note[:\s]+/i, "").trim() || raw.trim();
    const words = content.split(/\s+/);
    const title = words.slice(0, 7).join(" ") + (words.length > 7 ? "…" : "");
    const notes = loadNotes();
    notes.push({ id: uid(), title, content, createdAt: new Date().toISOString() });
    saveNotes(notes);
    await cb({ text: `📝 Note saved: "${title}"\n\n${notes.length} note${notes.length !== 1 ? "s" : ""} total. Say "list notes" to view them.`, action: "SAVE_NOTE" });
    return true;
  },
  examples: [],
};

const listNotesAction = {
  name: "LIST_NOTES",
  description: "Show all saved notes.",
  similes: ["SHOW_NOTES", "GET_NOTES", "MY_NOTES"],
  validate: async (_r: IAgentRuntime, msg: Memory) => {
    const t = msg.content.text?.toLowerCase() ?? "";
    return /\b(list|show|view|see|get)\b.*\bnotes?\b/.test(t) || /\bmy notes?\b/.test(t);
  },
  handler: async (_r: IAgentRuntime, _m: Memory, _s: State, _o: unknown, cb: HandlerCallback) => {
    const notes = loadNotes();
    if (!notes.length) { await cb({ text: '📓 No notes yet. Save one: "Note: your idea"', action: "LIST_NOTES" }); return true; }
    const recent = notes.slice(-10);
    let res = `📓 **Your Notes** (${notes.length} total):\n\n`;
    recent.forEach((n, i) => {
      res += `**${i + 1}. ${n.title}** *(${new Date(n.createdAt).toLocaleDateString()})*\n${n.content}\n\n`;
    });
    await cb({ text: res.trim(), action: "LIST_NOTES" });
    return true;
  },
  examples: [],
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. Agent authoring actions
// ─────────────────────────────────────────────────────────────────────────────

const NOSANA_INFERENCE_URL = "https://4ksj3tve5bazqwkuyqdhwdpcar4yutcuxphwhckrdxmu.node.k8s.prd.nos.ci/v1";
const NOSANA_EMBEDDING_URL = "https://4yiccatpyxx773jtewo5ccwhw1s2hezq5pehndb6fcfq.node.k8s.prd.nos.ci/v1";

const generateCharacterAction = {
  name: "GENERATE_CHARACTER",
  description:
    "Generate a complete ElizaOS character.json file for a new AI agent based on the user's description. " +
    "Trigger when the user asks to build, create, design, or generate an agent.",
  similes: ["BUILD_AGENT", "CREATE_AGENT", "DESIGN_AGENT", "NEW_AGENT", "AGENT_TEMPLATE"],
  validate: async (_r: IAgentRuntime, msg: Memory) => {
    const t = msg.content.text?.toLowerCase() ?? "";
    return (
      /\b(build|create|design|make|generate)\b.*\b(agent|character|bot)\b/.test(t) ||
      /\bagent\b.*\b(that|who|which)\b/.test(t) ||
      /\bgenerate (a )?(character|agent)\b/.test(t) ||
      /\bcharacter\.json\b/.test(t) ||
      /\bnew (ai )?agent\b/.test(t)
    );
  },
  handler: async (runtime: IAgentRuntime, msg: Memory, _s: State, _o: unknown, cb: HandlerCallback) => {
    const userRequest = msg.content.text ?? "";

    await cb({ text: "🔨 Generating your ElizaOS character file using AI… This takes a few seconds." });

    const prompt = `You are an expert ElizaOS agent architect. Generate a production-ready ElizaOS character.json file based on this request:

"${userRequest}"

Return ONLY valid JSON matching this schema exactly — no markdown, no explanation, just the JSON object:

{
  "name": "string (PascalCase agent name)",
  "username": "string (lowercase, no spaces)",
  "plugins": ["@elizaos/plugin-bootstrap", "@elizaos/plugin-openai"],
  "clients": [],
  "modelProvider": "openai",
  "settings": { "model": "Qwen/Qwen3.5-4B", "secrets": {} },
  "system": "string (detailed system prompt, 3-5 sentences, highly specific to this agent's purpose)",
  "bio": ["string (5 bio facts, specific to the agent's domain)"],
  "lore": ["string (3 lore items about the agent's origin and philosophy)"],
  "knowledge": ["string (8-10 domain-specific knowledge facts)"],
  "messageExamples": [
    [
      {"user": "{{user1}}", "content": {"text": "example question"}},
      {"user": "AgentName", "content": {"text": "detailed example response showing the agent's capabilities"}}
    ]
  ],
  "postExamples": ["2 social media post examples"],
  "topics": ["10-15 relevant topic strings"],
  "adjectives": ["6-8 personality adjective strings"],
  "style": {
    "all": ["4 universal style rules"],
    "chat": ["3 chat-specific rules"],
    "post": ["2 post-specific rules"]
  }
}

Make ALL content highly specific to the user's requested agent type. Include realistic knowledge, detailed examples, and a clear focused system prompt.`;

    try {
      const raw = await generateText({ runtime, context: prompt, modelClass: ModelClass.LARGE });

      // Extract JSON from the response
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in response");
      const jsonStr = jsonMatch[0];

      // Validate parseable
      const parsed = JSON.parse(jsonStr);
      const pretty = JSON.stringify(parsed, null, 2);

      await cb({
        text: `✅ **ElizaOS Character File Generated!**

\`\`\`json
${pretty}
\`\`\`

**Next steps:**
1. Save as \`characters/${(parsed.username ?? "my-agent")}.character.json\`
2. Test locally: \`elizaos start --character ./characters/${(parsed.username ?? "my-agent")}.character.json\`
3. Build & push Docker image, then ask me to **"generate Nosana job definition"** to deploy it

Want me to also create the Nosana deployment config for this agent?`,
        action: "GENERATE_CHARACTER",
      });
    } catch (err) {
      // Fallback: generate a sensible template
      const fallback = buildFallbackCharacter(userRequest);
      await cb({
        text: `📋 **Character Template** (customize the fields for your use case):

\`\`\`json
${JSON.stringify(fallback, null, 2)}
\`\`\`

Save as \`characters/my-agent.character.json\` and run \`elizaos start --character ./characters/my-agent.character.json\``,
        action: "GENERATE_CHARACTER",
      });
    }
    return true;
  },
  examples: [
    [
      { user: "User", content: { text: "Build me an agent that tracks Solana DeFi yields" } },
      { user: "NosaBot", content: { text: "🔨 Generating your ElizaOS character file…", action: "GENERATE_CHARACTER" } },
    ],
  ],
};

function buildFallbackCharacter(request: string) {
  const nameParts = request.replace(/[^a-zA-Z ]/g, "").trim().split(/\s+/);
  const name = nameParts.slice(0, 2).map(w => w[0].toUpperCase() + w.slice(1)).join("") + "Bot";
  return {
    name,
    username: name.toLowerCase(),
    plugins: ["@elizaos/plugin-bootstrap", "@elizaos/plugin-openai"],
    clients: [],
    modelProvider: "openai",
    settings: { model: "Qwen/Qwen3.5-4B", secrets: {} },
    system: `You are ${name}, an AI assistant specialized in: ${request}. Be concise, helpful, and accurate.`,
    bio: [`${name} is a specialized AI agent.`, "Runs on Nosana decentralized GPU infrastructure.", "Built with the ElizaOS framework."],
    lore: ["Deployed on the Nosana network.", "Powered by open-source models."],
    knowledge: ["Fill in domain-specific knowledge here."],
    messageExamples: [[
      { user: "{{user1}}", content: { text: "What can you help me with?" } },
      { user: name, content: { text: `I specialize in ${request}. How can I help you today?` } },
    ]],
    postExamples: [],
    topics: request.toLowerCase().split(/\s+/).slice(0, 5),
    adjectives: ["helpful", "knowledgeable", "reliable"],
    style: { all: ["Be concise and accurate."], chat: ["Be conversational."], post: [] },
  };
}

const generateJobDefAction = {
  name: "GENERATE_JOB_DEF",
  description:
    "Generate a Nosana job definition JSON to deploy an ElizaOS agent on the Nosana GPU network. " +
    "Trigger when user asks about deploying to Nosana, creating a job definition, or getting a deployment config.",
  similes: ["NOSANA_JOB", "DEPLOY_CONFIG", "JOB_DEFINITION", "DEPLOY_AGENT", "NOSANA_DEPLOY"],
  validate: async (_r: IAgentRuntime, msg: Memory) => {
    const t = msg.content.text?.toLowerCase() ?? "";
    return (
      /\bjob (def|definition|config)\b/.test(t) ||
      /\bdeploy (to )?nosana\b/.test(t) ||
      /\bnosana\b.*\b(deploy|job|config)\b/.test(t) ||
      /\bgenerate.*job\b/.test(t) ||
      /\bnosana.*config\b/.test(t) ||
      /\bhow (to |do i )?deploy\b/.test(t)
    );
  },
  handler: async (_r: IAgentRuntime, msg: Memory, _s: State, _o: unknown, cb: HandlerCallback) => {
    const text = msg.content.text ?? "";

    // Try to extract a Docker image name from the message
    const imgMatch =
      text.match(/image[:\s]+([a-z0-9][a-z0-9._/-]+:[a-z0-9._-]+)/i) ||
      text.match(/([a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*:[a-z0-9._-]+)/i);
    const image = imgMatch ? imgMatch[1] : "yourusername/my-eliza-agent:latest";

    const jobDef = {
      ops: [
        {
          id: "eliza-agent",
          args: {
            image,
            expose: 3000,
            env: {
              OPENAI_API_KEY: "nosana",
              OPENAI_API_URL: NOSANA_INFERENCE_URL,
              OPENAI_EMBEDDING_URL: NOSANA_EMBEDDING_URL,
              OPENAI_EMBEDDING_API_KEY: "nosana",
              OPENAI_EMBEDDING_MODEL: "Qwen3-Embedding-0.6B",
              OPENAI_EMBEDDING_DIMENSIONS: "1024",
              MODEL_NAME: "Qwen/Qwen3.5-4B",
              SERVER_PORT: "3000",
              NODE_ENV: "production",
              ELIZAOS_TELEMETRY_DISABLED: "true",
            },
          },
          execution: { group: "run" },
          type: "container/run",
        },
      ],
      version: "0.1",
    };

    await cb({
      text: `🚀 **Nosana Job Definition**

\`\`\`json
${JSON.stringify(jobDef, null, 2)}
\`\`\`

**Deployment steps:**
1. \`docker build -t ${image} .\`
2. \`docker push ${image}\`
3. Save the JSON above as \`job.json\`
4. \`nosana job post --file job.json --market nvidia-3090\`

Or deploy via the [Nosana Dashboard](https://app.nosana.io) → Post Job → paste the JSON.

**Replace** \`${image}\` with your actual Docker Hub image name first!`,
      action: "GENERATE_JOB_DEF",
    });
    return true;
  },
  examples: [],
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. Nosana network integration
// ─────────────────────────────────────────────────────────────────────────────

const NOSANA_API = "https://dashboard.k8s.prd.nos.ci/api";

async function nosanaFetch(path: string): Promise<unknown> {
  const res = await fetch(`${NOSANA_API}${path}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const nosanaJobStatusAction = {
  name: "NOSANA_JOB_STATUS",
  description:
    "Check the status of a Nosana job by its on-chain address/ID. " +
    "Trigger when the user provides a job ID and asks about its status.",
  similes: ["CHECK_JOB", "JOB_STATUS", "NOSANA_STATUS", "JOB_INFO"],
  validate: async (_r: IAgentRuntime, msg: Memory) => {
    const t = msg.content.text?.toLowerCase() ?? "";
    const hasId = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/.test(msg.content.text ?? "");
    return hasId && (/\b(job|status|check|nosana)\b/.test(t) || hasId);
  },
  handler: async (_r: IAgentRuntime, msg: Memory, _s: State, _o: unknown, cb: HandlerCallback) => {
    const text = msg.content.text ?? "";
    const idMatch = text.match(/\b([1-9A-HJ-NP-Za-km-z]{32,44})\b/);

    if (!idMatch) {
      await cb({ text: "Please provide a Nosana job address. Example: \"Check job status ABC123xyz...\"" });
      return true;
    }

    const jobId = idMatch[1];
    const short = jobId.slice(0, 8) + "…";

    try {
      const job = await nosanaFetch(`/jobs/${jobId}`) as Record<string, unknown>;
      const statusMap: Record<string, string> = {
        RUNNING: "🟡 Running", COMPLETED: "✅ Completed", FAILED: "❌ Failed",
        QUEUED: "⏳ Queued", STOPPED: "🔴 Stopped",
      };
      const statusStr = statusMap[String(job.status ?? "")] ?? `❓ ${job.status ?? "Unknown"}`;
      const created = job.createdAt ? new Date(String(job.createdAt)).toLocaleString() : "N/A";

      await cb({
        text: `📋 **Job ${short}**\n\n` +
          `• **Status:** ${statusStr}\n` +
          `• **Created:** ${created}\n` +
          `• **Market:** ${job.market ?? "N/A"}\n` +
          `• **Node:** ${job.node ? String(job.node).slice(0, 12) + "…" : "Unassigned"}\n\n` +
          `🔗 [View on Nosana Explorer](https://explorer.nosana.io/jobs/${jobId})`,
        action: "NOSANA_JOB_STATUS",
      });
    } catch {
      await cb({
        text: `📋 **Job ID:** \`${jobId}\`\n\n` +
          `I couldn't reach the Nosana API. Check your job directly:\n` +
          `🔗 [Nosana Explorer](https://explorer.nosana.io/jobs/${jobId})\n\n` +
          `Or run: \`nosana job get ${jobId}\``,
        action: "NOSANA_JOB_STATUS",
      });
    }
    return true;
  },
  examples: [],
};

const nosanaNetworkStatsAction = {
  name: "NOSANA_NETWORK_STATS",
  description:
    "Show Nosana network statistics: active GPU nodes, GPU types, pricing, and network health. " +
    "Trigger when user asks about the Nosana network, available GPUs, node count, or pricing.",
  similes: ["NOSANA_STATS", "NETWORK_STATS", "GPU_STATS", "NOSANA_INFO", "NODE_COUNT"],
  validate: async (_r: IAgentRuntime, msg: Memory) => {
    const t = msg.content.text?.toLowerCase() ?? "";
    return (
      /\bnosana\b.*\b(stats?|network|status|gpu|nodes?|available|pricing|cost)\b/.test(t) ||
      /\b(network|gpu)\b.*\bnosana\b/.test(t) ||
      /\bhow many (gpus?|nodes?)\b/.test(t) ||
      /\bnosana network\b/.test(t) ||
      /\bgpu (pricing|cost|availab)\b/.test(t)
    );
  },
  handler: async (_r: IAgentRuntime, _m: Memory, _s: State, _o: unknown, cb: HandlerCallback) => {
    try {
      const markets = await nosanaFetch("/markets") as unknown[];
      const nodes   = await nosanaFetch("/nodes/summary") as Record<string, unknown>;

      const totalNodes  = Number(nodes.total  ?? nodes.count   ?? 0);
      const activeNodes = Number(nodes.active ?? nodes.available ?? 0);
      const jobs        = Number(nodes.completedJobs ?? nodes.jobs ?? 0);

      let marketInfo = "";
      if (Array.isArray(markets) && markets.length) {
        marketInfo = "\n\n**Available GPU Markets:**\n";
        (markets as Record<string, unknown>[]).slice(0, 6).forEach((m) => {
          marketInfo += `• **${m.name ?? m.id ?? "GPU"}** — ${m.jobPrice ? `${m.jobPrice} NOS/hr` : "pricing varies"}\n`;
        });
      }

      await cb({
        text: `📊 **Nosana Network — Live Stats**\n\n` +
          `• **Total Nodes:** ${totalNodes || "N/A"}\n` +
          `• **Active Nodes:** ${activeNodes || "N/A"}\n` +
          `• **Jobs Completed:** ${jobs ? jobs.toLocaleString() : "N/A"}\n` +
          `• **Blockchain:** Solana Mainnet\n` +
          `• **Token:** NOS` +
          marketInfo +
          `\n\n🔗 [Live Dashboard](https://app.nosana.io) · [Explorer](https://explorer.nosana.io)`,
        action: "NOSANA_NETWORK_STATS",
      });
    } catch {
      // Fallback with static but accurate network info
      await cb({
        text: `📊 **Nosana Network**\n\n` +
          `• **Blockchain:** Solana Mainnet\n` +
          `• **Token:** NOS (Nosana)\n` +
          `• **GPU Types Available:** RTX 3090, RTX 4090, A4000, A100, H100\n` +
          `• **Use Case:** AI inference, model serving, ElizaOS agents\n` +
          `• **Pricing:** Community-set rates, typically 60-90% cheaper than AWS/GCP\n\n` +
          `**Why Nosana?**\n` +
          `• Decentralized — no single point of failure\n` +
          `• Censorship-resistant compute\n` +
          `• Pay in NOS, earn NOS by providing GPUs\n` +
          `• Open-source, built on Solana\n\n` +
          `🔗 [Dashboard](https://app.nosana.io) · [Explorer](https://explorer.nosana.io) · [Docs](https://docs.nosana.io)`,
        action: "NOSANA_NETWORK_STATS",
      });
    }
    return true;
  },
  examples: [],
};

// ─────────────────────────────────────────────────────────────────────────────
// Provider: combined context
// ─────────────────────────────────────────────────────────────────────────────

const productivityProvider = {
  name: "PRODUCTIVITY_CONTEXT",
  description: "Provides task/note summary as ambient context for every message.",
  get: async (_r: IAgentRuntime, _m: Memory) => {
    const tasks = loadTasks();
    const notes = loadNotes();
    const active = tasks.filter(t => !t.completed);
    const top5 = active.slice(0, 5).map(t => `- ${t.text}`).join("\n") || "(none)";
    return [
      "[Productivity Context]",
      `Active tasks (${active.length}):\n${top5}`,
      `Completed tasks: ${tasks.length - active.length}`,
      `Saved notes: ${notes.length}`,
    ].join("\n");
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Plugin export
// ─────────────────────────────────────────────────────────────────────────────

export const customPlugin: Plugin = {
  name: "nosana-agent-builder-plugin",
  description:
    "NosaBot's full capability set: task/note productivity tools, " +
    "AI-powered ElizaOS agent generation, Nosana job management, and network stats.",
  actions: [
    // Productivity
    addTaskAction,
    listTasksAction,
    completeTaskAction,
    saveNoteAction,
    listNotesAction,
    // Agent authoring
    generateCharacterAction,
    generateJobDefAction,
    // Nosana integration
    nosanaJobStatusAction,
    nosanaNetworkStatsAction,
  ],
  providers: [productivityProvider],
  evaluators: [],
};

export default customPlugin;
