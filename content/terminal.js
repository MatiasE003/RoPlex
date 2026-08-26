import { executeTerminalCommand } from "./terminal-commands.js";

export function mountTerminal(root) {
  const input = root.querySelector("#roblox-extension-terminal__input");
  const transcript = root.querySelector("#roblox-extension-terminal__transcript");

  if (!(input instanceof HTMLInputElement) || !(transcript instanceof HTMLElement)) {
    throw new Error("Terminal markup is missing its input or transcript.");
  }

  let running = false;
  const commandHistory = [];
  let historyIndex = null;
  let historyDraft = "";
  input.focus({ preventScroll: true });

  input.addEventListener("keydown", async (event) => {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      recallPreviousCommand();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      recallNextCommand();
      return;
    }

    if (event.key !== "Enter" || running) {
      return;
    }

    event.preventDefault();
    const command = input.value.trim();
    input.value = "";

    if (!command) {
      return;
    }

    commandHistory.push(command);
    historyIndex = null;
    historyDraft = "";
    appendCommand(command);
    running = true;
    input.disabled = true;

    try {
      const result = await executeTerminalCommand(command);

      if (!root.isConnected) {
        return;
      }

      if (result?.type === "clear") {
        transcript.replaceChildren();
      } else if (result?.type === "output") {
        appendOutput(result.value);
      } else if (result?.type === "navigate") {
        location.assign(result.url);
      }
    } catch (error) {
      if (root.isConnected) {
        appendOutput(
          error instanceof Error ? error.message : "El comando no se pudo ejecutar.",
          true,
        );
      }
    } finally {
      if (root.isConnected) {
        running = false;
        input.disabled = false;
        input.focus({ preventScroll: true });
      }
    }
  });

  function recallPreviousCommand() {
    if (!commandHistory.length) {
      return;
    }

    if (historyIndex === null) {
      historyDraft = input.value;
      historyIndex = commandHistory.length - 1;
    } else {
      historyIndex = Math.max(0, historyIndex - 1);
    }

    input.value = commandHistory[historyIndex];
  }

  function recallNextCommand() {
    if (historyIndex === null) {
      return;
    }

    historyIndex += 1;

    if (historyIndex >= commandHistory.length) {
      historyIndex = null;
      input.value = historyDraft;
      return;
    }

    input.value = commandHistory[historyIndex];
  }

  function appendCommand(command) {
    const entry = document.createElement("p");
    const prompt = document.createElement("span");
    prompt.className = "roblox-extension-terminal__entry--prompt";
    prompt.textContent = "roblox@terminal:~$ ";
    entry.className = "roblox-extension-terminal__entry roblox-extension-terminal__entry--command";
    entry.append(prompt, command);
    transcript.append(entry);
    scrollTranscriptToBottom();
  }

  function appendOutput(value, isError = false) {
    if (typeof value !== "string" || !value) {
      return;
    }

    const entry = document.createElement("p");
    entry.className = `roblox-extension-terminal__entry${
      isError ? " roblox-extension-terminal__entry--error" : ""
    }`;
    entry.textContent = value;
    transcript.append(entry);
    scrollTranscriptToBottom();
  }

  function scrollTranscriptToBottom() {
    transcript.scrollTop = transcript.scrollHeight;
  }
}
