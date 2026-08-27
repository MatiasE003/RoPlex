import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BACKGROUND_SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "background", "service-worker.js"),
  "utf8",
);

function createEvent() {
  const listeners = [];
  return {
    addListener(listener) {
      listeners.push(listener);
    },
    emit(...args) {
      listeners.forEach((listener) => listener(...args));
    },
  };
}

function createPort() {
  const onMessage = createEvent();
  const onDisconnect = createEvent();
  const messages = [];
  let disconnected = false;

  return {
    disconnected() {
      return disconnected;
    },
    disconnect() {
      if (!disconnected) {
        disconnected = true;
        onDisconnect.emit();
      }
    },
    messages,
    name: "roblox-server-analysis",
    onDisconnect,
    onMessage,
    postMessage(message) {
      if (!disconnected) {
        messages.push(message);
      }
    },
    receive(message) {
      onMessage.emit(message);
    },
    sender: {
      tab: {
        id: 42,
        url: "https://www.roblox.com/games/920587237/example#!/game-instances",
      },
    },
  };
}

function makeJobId(index) {
  return `job-${String(index).padStart(8, "0")}`;
}

function createHarness({ cached, pageCount, serversPerPage }) {
  const runtimeOnConnect = createEvent();
  const stats = {
    abortInjections: 0,
    arrayCacheReads: 0,
    joinInjections: 0,
    pageFetches: 0,
    storageWrites: 0,
  };
  const activeJoinInjections = new Map();
  const now = Date.now();

  const chrome = {
    runtime: {
      onConnect: runtimeOnConnect,
      onInstalled: createEvent(),
      onMessage: createEvent(),
      onStartup: createEvent(),
    },
    scripting: {
      async executeScript(details) {
        if (details.args.length === 1) {
          stats.abortInjections += 1;
          const operationId = details.args[0];
          const resolvers = activeJoinInjections.get(operationId) || [];
          resolvers.forEach((resolve) =>
            resolve([
              {
                result: {
                  aborted: true,
                  networkError: "aborted",
                },
              },
            ]),
          );
          activeJoinInjections.delete(operationId);
          return [];
        }

        stats.joinInjections += 1;
        const operationId = details.args[2];
        return new Promise((resolve) => {
          const resolvers = activeJoinInjections.get(operationId) || [];
          resolvers.push(resolve);
          activeJoinInjections.set(operationId, resolvers);
        });
      },
    },
    storage: {
      local: {
        async get() {
          return {};
        },
        async remove() {},
        async set() {},
      },
      session: {
        async get(keys) {
          if (!Array.isArray(keys)) {
            return {};
          }

          stats.arrayCacheReads += 1;

          if (!cached) {
            return {};
          }

          return Object.fromEntries(
            keys.map((key) => {
              const jobId = key.replace("roblox-server-region:", "");
              return [
                key,
                {
                  cacheVersion: 3,
                  dataCenterId: null,
                  endpointAddress: null,
                  jobId,
                  placeId: 920587237,
                  region: "test-region",
                  timestamp: now,
                },
              ];
            }),
          );
        },
        async remove() {},
        async set() {
          stats.storageWrites += 1;
        },
      },
    },
  };

  async function fetch(url) {
    const parsed = new URL(url);
    const cursor = parsed.searchParams.get("cursor");
    const pageIndex = cursor ? Number(cursor.replace("cursor-", "")) : 0;
    const firstIndex = pageIndex * serversPerPage;
    const data = Array.from({ length: serversPerPage }, (_, offset) => ({
      fps: 60,
      id: makeJobId(firstIndex + offset),
      maxPlayers: 30,
      ping: 50,
      playing: offset % 30,
    }));
    stats.pageFetches += 1;
    const nextPageCursor =
      pageIndex + 1 < pageCount ? `cursor-${pageIndex + 1}` : null;

    return {
      headers: { get: () => null },
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data, nextPageCursor }),
    };
  }

  const context = vm.createContext({
    AbortController,
    URL,
    chrome,
    clearTimeout,
    console,
    fetch,
    setTimeout,
  });
  vm.runInContext(BACKGROUND_SOURCE, context, {
    filename: "background/service-worker.js",
  });

  return {
    connect(port) {
      runtimeOnConnect.emit(port);
    },
    stats,
  };
}

function waitForMessage(port, type, timeoutMs = 3000) {
  const existing = port.messages.find((message) => message.type === type);

  if (existing) {
    return Promise.resolve(existing);
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for ${type}`)),
      timeoutMs,
    );
    const interval = setInterval(() => {
      const message = port.messages.find((item) => item.type === type);

      if (message) {
        clearInterval(interval);
        clearTimeout(timeout);
        resolve(message);
      }
    }, 5);
  });
}

test("a 5,000-server fixture follows all 50 cursors with page-batched cache reads and bounded chunks", async () => {
  const harness = createHarness({
    cached: true,
    pageCount: 50,
    serversPerPage: 100,
  });
  const port = createPort();
  harness.connect(port);
  port.receive({
    operationId: "fixture-5000",
    placeId: 920587237,
    sortOrder: "Desc",
    type: "START_ANALYSIS",
  });

  const complete = await waitForMessage(port, "ANALYSIS_COMPLETE", 5000);
  const chunks = port.messages.filter(
    (message) => message.type === "ANALYSIS_RESULTS",
  );
  const resultCount = chunks.reduce(
    (total, message) => total + message.results.length,
    0,
  );

  assert.equal(complete.totalCount, 5000);
  assert.equal(complete.processedCount, 5000);
  assert.equal(complete.cachedCount, 5000);
  assert.equal(resultCount, 5000);
  assert.equal(harness.stats.pageFetches, 50);
  assert.equal(harness.stats.arrayCacheReads, 50);
  assert.equal(harness.stats.joinInjections, 0);
  assert.equal(
    port.messages.filter((message) => message.type === "ANALYSIS_STARTED")
      .length,
    1,
  );
  assert.ok(chunks.every((message) => message.results.length <= 24));
  assert.ok(
    chunks.some((message) => message.paginationComplete === false),
    "first-page results should stream before pagination completes",
  );
});

test("cancellation aborts active MAIN-world work and starts no later region checks", async () => {
  const harness = createHarness({
    cached: false,
    pageCount: 1,
    serversPerPage: 100,
  });
  const port = createPort();
  harness.connect(port);
  port.receive({
    operationId: "cancel-fixture",
    placeId: 920587237,
    sortOrder: "Asc",
    type: "START_ANALYSIS",
  });

  while (harness.stats.joinInjections === 0) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  port.receive({ operationId: "cancel-fixture", type: "CANCEL_ANALYSIS" });
  await waitForMessage(port, "ANALYSIS_CANCELLED");
  const joinCountAtCancel = harness.stats.joinInjections;
  await new Promise((resolve) => setTimeout(resolve, 100));

  assert.equal(harness.stats.abortInjections, 1);
  assert.equal(harness.stats.joinInjections, joinCountAtCancel);
  assert.ok(joinCountAtCancel <= 1);
  const cancelledIndex = port.messages.findIndex(
    (message) => message.type === "ANALYSIS_CANCELLED",
  );
  assert.equal(
    port.messages
      .slice(cancelledIndex + 1)
      .some((message) => message.type === "ANALYSIS_RESULTS"),
    false,
  );
});
