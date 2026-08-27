import assert from "node:assert/strict";
import test from "node:test";

import {
  executeTerminalCommand,
  listTerminalCommands,
} from "../terminal/terminal-commands.js";

test("ls requests a user friend list and formats it in vertical columns", async () => {
  const friends = "abcdefg".split("").map((letter, index) => ({
    id: index + 1,
    isPremium: index === 0 || index === 6,
    name: letter.repeat(20),
  }));
  let request;
  globalThis.chrome = {
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        request = message;
        callback({ ok: true, data: { friends, userId: 42 } });
      },
    },
  };

  const result = await executeTerminalCommand("ls TargetUser");

  assert.deepEqual(request, {
    target: "TargetUser",
    type: "GET_TERMINAL_USER_FRIENDS",
  });
  assert.deepEqual(result, {
    type: "output",
    highlights: [
      { length: 20, start: 0 },
      { length: 20, start: 44 },
    ],
    value: [
      `${friends[0].name}  ${friends[3].name}  ${friends[6].name}`,
      `${friends[1].name}  ${friends[4].name}`,
      `${friends[2].name}  ${friends[5].name}`,
    ].join("\n"),
  });
  assert.ok(listTerminalCommands().some(({ name }) => name === "ls"));
});
