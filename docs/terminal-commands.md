# Terminal commands

The Roblox terminal is mounted only on `/terminal`. Its browser-facing behavior is split into three small modules:

- `content/terminal.html` owns the terminal markup and visual states.
- `content/terminal.js` handles Enter, output, and navigation results.
- `content/terminal-commands.js` owns the command registry and command implementations.

## Registering a command

Import `registerTerminalCommand` in `content/terminal-commands.js` and register it at module scope:

```js
registerTerminalCommand({
  name: "example",
  async execute({ args }) {
    // Use args, then return a result or throw an Error for red terminal output.
    return { type: "navigate", url: "/home" };
  },
});
```

Names must be lowercase letters, digits, or hyphens and cannot be registered twice. Arguments are whitespace-separated. Unknown commands and errors thrown by a command are shown in red above the prompt. Return `{ type: "output", value: "..." }` for normal transcript output, `{ type: "navigate", url: "..." }` to navigate, or `{ type: "clear" }` to clear the transcript.

Commands that need Roblox APIs must call the background service worker through `sendMessage`; add a message type in `content/config.js`, validate it in `background.js::handleMessage`, and keep the service worker authoritative for API requests and identity checks.

## Built-in command

`profile [user-id-or-nickname]` accepts a numeric Roblox UserId, an exact username, or an exact display nickname (including spaces), then navigates to that profile. Username matches take priority; a nickname is resolved through Roblox search only when no username matches. With no argument it resolves the currently authenticated Roblox account and opens its profile. The resolution request is `GET_TERMINAL_PROFILE_TARGET` and is handled by the background service worker.

`help` lists registered commands and `clear` clears the visible transcript. The terminal keeps command/output history for the current mounted session; Up and Down recall previous commands, while scrolling is confined to the transcript instead of the page.
