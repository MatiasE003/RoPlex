import { MESSAGE_TYPES } from "../shared/config.js";
import { sendMessage } from "../shared/messaging.js";

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

function formatLsColumns(values, maximumWidth = 80) {
  if (!values.length) {
    return { highlights: [], value: "" };
  }

  const gap = 2;
  const columnWidth = Math.max(...values.map(({ name }) => name.length)) + gap;
  const columnCount = Math.max(1, Math.floor((maximumWidth + gap) / columnWidth));
  const rowCount = Math.ceil(values.length / columnCount);
  const highlights = [];
  let value = "";

  for (let row = 0; row < rowCount; row += 1) {
    if (row > 0) {
      value += "\n";
    }

    for (let column = 0; column < columnCount; column += 1) {
      const index = column * rowCount + row;

      if (index >= values.length) {
        break;
      }

      const friend = values[index];
      const nextIndex = (column + 1) * rowCount + row;
      const start = value.length;
      value += friend.name;

      if (friend.isPremium) {
        highlights.push({ length: friend.name.length, start });
      }

      if (nextIndex < values.length) {
        value += " ".repeat(columnWidth - friend.name.length);
      }
    }
  }

  return { highlights, value };
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
  name: "desc",
  description: "Show a Roblox user's current description by UserId or username.",
  async execute({ args }) {
    if (args.length !== 1) {
      throw new TerminalCommandError("Uso: desc <UserId|nombre>");
    }

    const user = await sendMessage({
      target: args[0],
      type: MESSAGE_TYPES.terminalDescription,
    });
    const description = user.description || "Este usuario no tiene descripción.";

    return {
      type: "output",
      value: `@${user.username} (${user.userId})\n${description}`,
    };
  },
});

registerTerminalCommand({
  name: "ls",
  description: "List a Roblox user's friends by UserId or username.",
  async execute({ args }) {
    if (args.length !== 1) {
      throw new TerminalCommandError("Uso: ls <UserId|nombre>");
    }

    const { friends } = await sendMessage({
      target: args[0],
      type: MESSAGE_TYPES.terminalFriends,
    });

    return {
      type: "output",
      ...(friends.length
        ? formatLsColumns(friends)
        : { value: "Este usuario no tiene amigos públicos." }),
    };
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
