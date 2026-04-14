/**
 * NosaBot Productivity Plugin
 *
 * Provides task management, note-taking, and productivity context
 * for the NosaBot agent running on Nosana decentralized infrastructure.
 *
 * ElizaOS Plugin Docs: https://elizaos.github.io/eliza/docs/core/plugins
 */

import { type Plugin, type IAgentRuntime, type Memory, type State, type HandlerCallback } from "@elizaos/core";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

const DATA_DIR = process.env.SQLITE_DATA_DIR || "./data";
const TASKS_FILE = path.join(DATA_DIR, "tasks.json");
const NOTES_FILE = path.join(DATA_DIR, "notes.json");

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadTasks(): Task[] {
  ensureDataDir();
  if (!fs.existsSync(TASKS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(TASKS_FILE, "utf-8")) as Task[];
  } catch {
    return [];
  }
}

function saveTasks(tasks: Task[]): void {
  ensureDataDir();
  fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
}

function loadNotes(): Note[] {
  ensureDataDir();
  if (!fs.existsSync(NOTES_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(NOTES_FILE, "utf-8")) as Note[];
  } catch {
    return [];
  }
}

function saveNotes(notes: Note[]): void {
  ensureDataDir();
  fs.writeFileSync(NOTES_FILE, JSON.stringify(notes, null, 2));
}

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// ---------------------------------------------------------------------------
// Action: ADD_TASK
// ---------------------------------------------------------------------------

const addTaskAction = {
  name: "ADD_TASK",
  description:
    "Add a new task to the user's task list. Trigger when the user asks to add, create, track, or remember a task or to-do item.",
  similes: ["CREATE_TASK", "NEW_TASK", "TRACK_TASK", "TODO", "REMIND_ME"],
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const t = message.content.text?.toLowerCase() ?? "";
    return (
      /\badd\b.*\btask\b/.test(t) ||
      /\bcreate\b.*\btask\b/.test(t) ||
      /\bnew task\b/.test(t) ||
      /\bremind me to\b/.test(t) ||
      /\bremember to\b/.test(t) ||
      /\btodo[:\s]/.test(t) ||
      /\bto.?do[:\s]/.test(t) ||
      /\btrack\b.*\btask\b/.test(t)
    );
  },
  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: unknown,
    callback: HandlerCallback
  ) => {
    const raw = message.content.text ?? "";
    // Strip common prefixes to extract the task text
    const taskText = raw
      .replace(/^(add|create|new)\s+(a\s+)?task[:\s]+/i, "")
      .replace(/^remind me to\s+/i, "")
      .replace(/^remember to\s+/i, "")
      .replace(/^todo[:\s]+/i, "")
      .replace(/^to.?do[:\s]+/i, "")
      .trim() || raw.trim();

    const tasks = loadTasks();
    const newTask: Task = {
      id: uid(),
      text: taskText,
      completed: false,
      createdAt: new Date().toISOString(),
    };
    tasks.push(newTask);
    saveTasks(tasks);

    const active = tasks.filter((t) => !t.completed).length;
    await callback({
      text: `✅ Task added: "${taskText}"\n\nYou now have ${active} active task${active !== 1 ? "s" : ""}. Say "list tasks" to see them all.`,
      action: "ADD_TASK",
    });
    return true;
  },
  examples: [
    [
      { user: "User", content: { text: "Add task: Review the pull request" } },
      {
        user: "NosaBot",
        content: {
          text: '✅ Task added: "Review the pull request"\n\nYou now have 1 active task. Say "list tasks" to see them all.',
          action: "ADD_TASK",
        },
      },
    ],
  ],
};

// ---------------------------------------------------------------------------
// Action: LIST_TASKS
// ---------------------------------------------------------------------------

const listTasksAction = {
  name: "LIST_TASKS",
  description:
    "Show the user's current task list. Trigger when the user asks to see, show, list, or view their tasks.",
  similes: ["SHOW_TASKS", "GET_TASKS", "VIEW_TASKS", "MY_TASKS"],
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const t = message.content.text?.toLowerCase() ?? "";
    return (
      /\b(list|show|view|see|get)\b.*\btasks?\b/.test(t) ||
      /\bmy tasks?\b/.test(t) ||
      /\ball tasks?\b/.test(t) ||
      /\bwhat(\'s| is) on my (task|todo) list\b/.test(t)
    );
  },
  handler: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State,
    _options: unknown,
    callback: HandlerCallback
  ) => {
    const tasks = loadTasks();

    if (tasks.length === 0) {
      await callback({
        text: '📋 You have no tasks yet! Add one by saying "Add task: your task here".',
        action: "LIST_TASKS",
      });
      return true;
    }

    const active = tasks.filter((t) => !t.completed);
    const done = tasks.filter((t) => t.completed);

    let res = "📋 **Your Tasks:**\n\n";

    if (active.length > 0) {
      res += "**Active:**\n";
      active.forEach((t, i) => {
        res += `${i + 1}. ☐ ${t.text}\n`;
      });
    } else {
      res += "**Active:** *(none — great job!)*\n";
    }

    if (done.length > 0) {
      res += `\n**Completed (${done.length}):**\n`;
      done.slice(-5).forEach((t) => {
        res += `• ✅ ${t.text}\n`;
      });
      if (done.length > 5) res += `*…and ${done.length - 5} more.*\n`;
    }

    await callback({ text: res.trim(), action: "LIST_TASKS" });
    return true;
  },
  examples: [
    [
      { user: "User", content: { text: "Show my tasks" } },
      {
        user: "NosaBot",
        content: {
          text: "📋 **Your Tasks:**\n\n**Active:**\n1. ☐ Review the pull request",
          action: "LIST_TASKS",
        },
      },
    ],
  ],
};

// ---------------------------------------------------------------------------
// Action: COMPLETE_TASK
// ---------------------------------------------------------------------------

const completeTaskAction = {
  name: "COMPLETE_TASK",
  description:
    "Mark a task as done. Trigger when the user says they finished, completed, or are done with a task.",
  similes: ["DONE_TASK", "FINISH_TASK", "MARK_DONE", "TASK_COMPLETE"],
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const t = message.content.text?.toLowerCase() ?? "";
    return (
      (/\b(complete|done|finish(ed)?|mark)\b/.test(t) && /\btask\b/.test(t)) ||
      /\bcompleted? task #?\d+\b/.test(t) ||
      /\bmark #?\d+ (as )?(done|complete)\b/.test(t)
    );
  },
  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: unknown,
    callback: HandlerCallback
  ) => {
    const tasks = loadTasks();
    const active = tasks.filter((t) => !t.completed);
    const text = message.content.text ?? "";

    let target: Task | undefined;

    // Match by task number
    const numMatch = text.match(/\b(\d+)\b/);
    if (numMatch) {
      const idx = parseInt(numMatch[1], 10) - 1;
      if (idx >= 0 && idx < active.length) {
        target = active[idx];
      }
    }

    // Fuzzy match by task text
    if (!target) {
      const search = text
        .toLowerCase()
        .replace(/\b(complete|done|finish(ed)?|mark|task)\b/g, "")
        .trim();
      target = active.find((t) => t.text.toLowerCase().includes(search));
    }

    if (!target) {
      if (active.length === 0) {
        await callback({ text: "You have no active tasks to complete. Great work!" });
      } else {
        const list = active.map((t, i) => `${i + 1}. ${t.text}`).join("\n");
        await callback({
          text: `I couldn't identify which task to complete. Your active tasks:\n${list}\n\nTry "complete task 1" to mark the first one done.`,
        });
      }
      return true;
    }

    const i = tasks.findIndex((t) => t.id === target!.id);
    tasks[i].completed = true;
    tasks[i].completedAt = new Date().toISOString();
    saveTasks(tasks);

    const remaining = tasks.filter((t) => !t.completed).length;
    await callback({
      text: `✅ Marked "${target.text}" as complete! ${remaining} task${remaining !== 1 ? "s" : ""} remaining.`,
      action: "COMPLETE_TASK",
    });
    return true;
  },
  examples: [],
};

// ---------------------------------------------------------------------------
// Action: SAVE_NOTE
// ---------------------------------------------------------------------------

const saveNoteAction = {
  name: "SAVE_NOTE",
  description:
    "Save a note for the user. Trigger when the user asks to note, jot down, write down, or remember a piece of information (not a task).",
  similes: ["CREATE_NOTE", "WRITE_NOTE", "JOT_DOWN", "REMEMBER_NOTE"],
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const t = message.content.text?.toLowerCase() ?? "";
    return (
      /\bsave (a )?note\b/.test(t) ||
      /\bnote[:\s]+\S/.test(t) ||
      /\bnote that\b/.test(t) ||
      /\bjot (this )?down\b/.test(t) ||
      /\bwrite (this )?down\b/.test(t) ||
      /\btake a note\b/.test(t) ||
      /\bremember that\b/.test(t)
    );
  },
  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: unknown,
    callback: HandlerCallback
  ) => {
    const raw = message.content.text ?? "";
    const content = raw
      .replace(/^save (a )?note[:\s]+/i, "")
      .replace(/^note[:\s]+/i, "")
      .replace(/^note that\s+/i, "")
      .replace(/^jot (this )?down[:\s]+/i, "")
      .replace(/^write (this )?down[:\s]+/i, "")
      .replace(/^take a note[:\s]+/i, "")
      .replace(/^remember that\s+/i, "")
      .trim() || raw.trim();

    const words = content.split(/\s+/);
    const title = words.slice(0, 7).join(" ") + (words.length > 7 ? "…" : "");

    const notes = loadNotes();
    const newNote: Note = {
      id: uid(),
      title,
      content,
      createdAt: new Date().toISOString(),
    };
    notes.push(newNote);
    saveNotes(notes);

    await callback({
      text: `📝 Note saved: "${title}"\n\nYou have ${notes.length} note${notes.length !== 1 ? "s" : ""} total. Say "list notes" to review them.`,
      action: "SAVE_NOTE",
    });
    return true;
  },
  examples: [],
};

// ---------------------------------------------------------------------------
// Action: LIST_NOTES
// ---------------------------------------------------------------------------

const listNotesAction = {
  name: "LIST_NOTES",
  description:
    "Show all saved notes. Trigger when the user asks to see, list, or view their notes.",
  similes: ["SHOW_NOTES", "GET_NOTES", "VIEW_NOTES", "MY_NOTES"],
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const t = message.content.text?.toLowerCase() ?? "";
    return (
      /\b(list|show|view|see|get)\b.*\bnotes?\b/.test(t) ||
      /\bmy notes?\b/.test(t) ||
      /\ball notes?\b/.test(t)
    );
  },
  handler: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State,
    _options: unknown,
    callback: HandlerCallback
  ) => {
    const notes = loadNotes();

    if (notes.length === 0) {
      await callback({
        text: '📓 You have no notes yet. Save one by saying "Note: your idea here".',
        action: "LIST_NOTES",
      });
      return true;
    }

    const recent = notes.slice(-10);
    let res = `📓 **Your Notes** (${notes.length} total):\n\n`;
    recent.forEach((n, i) => {
      const date = new Date(n.createdAt).toLocaleDateString();
      res += `**${i + 1}. ${n.title}** *(${date})*\n`;
      res += `${n.content}\n\n`;
    });
    if (notes.length > 10) {
      res += `*Showing 10 most recent. ${notes.length - 10} older notes not shown.*`;
    }

    await callback({ text: res.trim(), action: "LIST_NOTES" });
    return true;
  },
  examples: [],
};

// ---------------------------------------------------------------------------
// Provider: Productivity context
// ---------------------------------------------------------------------------

const productivityProvider = {
  name: "PRODUCTIVITY_CONTEXT",
  description:
    "Injects a brief summary of the user's tasks and notes into every prompt so the agent can reference them naturally.",
  get: async (_runtime: IAgentRuntime, _message: Memory) => {
    const tasks = loadTasks();
    const notes = loadNotes();
    const activeTasks = tasks.filter((t) => !t.completed);
    const completedCount = tasks.length - activeTasks.length;

    const taskSummary =
      activeTasks.length > 0
        ? activeTasks.slice(0, 5).map((t) => `- ${t.text}`).join("\n")
        : "(none)";

    return [
      "[Productivity Context]",
      `Active tasks (${activeTasks.length}): \n${taskSummary}`,
      `Completed tasks: ${completedCount}`,
      `Saved notes: ${notes.length}`,
    ].join("\n");
  },
};

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

export const customPlugin: Plugin = {
  name: "nosana-productivity-plugin",
  description:
    "Task management, note-taking, and productivity tools for NosaBot — running on Nosana decentralized infrastructure.",
  actions: [
    addTaskAction,
    listTasksAction,
    completeTaskAction,
    saveNoteAction,
    listNotesAction,
  ],
  providers: [productivityProvider],
  evaluators: [],
};

export default customPlugin;
