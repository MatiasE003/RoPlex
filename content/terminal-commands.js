import { MESSAGE_TYPES } from "./config.js";
import { sendMessage } from "./messaging.js";

const commands = new Map();

export class TerminalCommandError extends Error {
  constructor(message) {
    super(message);
    this.name = "TerminalCommandError";
  }
}

export function registerTerminalCommand({ name, description = "", execute }) {
  const normalizedName = typeof name === "string" ? name.trim().toLowerCase() : "";

  if (!/^[a-z][a-z0-9-]*$/.test(normalizedName) || typeof execute !== "function") {
    throw new TypeError("Terminal commands need a valid name and execute function.");
  }

  if (commands.has(normalizedName)) {
    throw new Error(`The terminal command ${normalizedName} is already registered.`);
  }

  commands.set(normalizedName, { description, execute });
}

export function listTerminalCommands() {
  return Array.from(commands, ([name, command]) => ({
    description: command.description,
    name,
  }));
}

export async function executeTerminalCommand(input) {
  const tokens = typeof input === "string" ? input.trim().split(/\s+/) : [];
  const [name = "", ...args] = tokens;

  if (!name) {
    return null;
  }

  const command = commands.get(name.toLowerCase());

  if (!command) {
    throw new TerminalCommandError(`El comando ${name} no existe.`);
  }

  return command.execute({ args });
}

registerTerminalCommand({
  name: "clear",
  description: "Clear the terminal history.",
  execute() {
    return { type: "clear" };
  },
});

registerTerminalCommand({
  name: "help",
  description: "Show available commands.",
  execute() {
    const commandList = listTerminalCommands()
      .map(({ description, name }) => `${name}${description ? ` — ${description}` : ""}`)
      .join("\n");

    return { type: "output", value: commandList };
  },
});

registerTerminalCommand({
  name: "profile",
  description: "Open a profile by UserId, username, or nickname.",
  async execute({ args }) {
    const target = args.join(" ");
    const { userId } = await sendMessage({
      target: target || null,
      type: MESSAGE_TYPES.terminalProfileTarget,
    });

    return { type: "navigate", url: `/users/${userId}/profile` };
  },
});
