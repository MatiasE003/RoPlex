import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const BACKGROUND_SOURCE = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "background.js"),
  "utf8",
);

function createEvent() {
  return { addListener() {} };
}

function createStorageArea(overrides = {}) {
  return {
    async get() {
      return {};
    },
    async remove() {},
    async set() {},
    ...overrides,
  };
}

function createHarness({ fetch, local, session } = {}) {
  const chrome = {
    runtime: {
      onConnect: createEvent(),
      onInstalled: createEvent(),
      onMessage: createEvent(),
      onStartup: createEvent(),
    },
    scripting: { async executeScript() { return []; } },
    storage: {
      local: local || createStorageArea(),
      session: session || createStorageArea(),
    },
  };
  const context = vm.createContext({
    AbortController,
    DOMException,
    Headers,
    Response,
    URL,
    chrome,
    clearTimeout,
    console,
    crypto: webcrypto,
    fetch: fetch || (async () => jsonResponse({})),
    setTimeout,
  });
  vm.runInContext(BACKGROUND_SOURCE, context, { filename: "background.js" });
  return context;
}

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), { headers, status });
}

async function waitFor(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for state");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

test("an HTTP attempt times out while consuming a hung response", async () => {
  const context = createHarness({
    fetch: async (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      }),
  });

  await assert.rejects(
    context.runHttpAttempt(
      "https://users.roblox.com/v1/test",
      {},
      { attemptTimeoutMs: 20 },
      Date.now() + 500,
    ),
    (error) => error?.code === "HTTP_ATTEMPT_TIMEOUT",
  );
});

test("per-origin concurrency caps simultaneous requests", async () => {
  let active = 0;
  let maximum = 0;
  const context = createHarness({
    fetch: async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active -= 1;
      return jsonResponse({ ok: true });
    },
  });
  const deadlineAt = Date.now() + 2_000;

  await Promise.all(
    Array.from({ length: 18 }, () =>
      context.runHttpAttempt(
        "https://users.roblox.com/v1/test",
        {},
        { attemptTimeoutMs: 500 },
        deadlineAt,
      ),
    ),
  );

  assert.equal(maximum, 6);
});

test("a Retry-After beyond the operation deadline fails fast", async () => {
  let requests = 0;
  const context = createHarness({
    fetch: async () => {
      requests += 1;
      return jsonResponse({}, 429, { "Retry-After": "120" });
    },
  });

  await assert.rejects(
    context.fetchJsonWithRetry("https://users.roblox.com/v1/test", {
      httpPolicy: { operationDeadlineMs: 2_000 },
    }),
    (error) =>
      error?.code === "RATE_LIMITED" &&
      error?.details?.retryAfterMs === 120_000,
  );
  assert.equal(requests, 1);
});

test("personalized Home discovery never joins another account's request", async () => {
  let authenticatedUserId = 101;
  const discoveryResolvers = [];
  let discoveryRequests = 0;
  const context = createHarness({
    fetch: async (input) => {
      const url = new URL(input);
      if (url.pathname === "/v1/users/authenticated") {
        return jsonResponse({ id: authenticatedUserId });
      }
      if (url.pathname === "/discovery-api/omni-recommendation") {
        discoveryRequests += 1;
        return new Promise((resolve) => discoveryResolvers.push(resolve));
      }
      throw new Error(`Unexpected URL ${url.href}`);
    },
  });

  const first = context.fetchHomeDiscoveryFeed();
  await waitFor(() => discoveryResolvers.length === 1);
  authenticatedUserId = 202;
  const second = context.fetchHomeDiscoveryFeed();
  await waitFor(() => discoveryResolvers.length === 2);
  discoveryResolvers[1](jsonResponse({ contentMetadata: {}, sorts: [] }));
  assert.equal((await second).sorts.length, 0);
  discoveryResolvers[0](jsonResponse({ contentMetadata: {}, sorts: [] }));
  await assert.rejects(
    first,
    (error) => error?.code === "AUTHENTICATED_USER_CHANGED",
  );
  await context.fetchHomeDiscoveryFeed();
  assert.equal(discoveryRequests, 2);
});

test("friend previews deduplicate work and keep bounded stable/activity caches", async () => {
  const counts = new Map();
  const context = createHarness({
    fetch: async (input) => {
      const url = new URL(input);
      counts.set(url.hostname + url.pathname, (counts.get(url.hostname + url.pathname) || 0) + 1);
      if (url.hostname === "users.roblox.com") {
        return jsonResponse({ created: "2020-01-01T00:00:00.000Z" });
      }
      if (url.hostname === "friends.roblox.com") return jsonResponse({ count: 7 });
      if (url.hostname === "games.roblox.com") {
        return jsonResponse({ data: [{ name: "Example", rootPlaceId: 44 }] });
      }
      if (url.hostname === "thumbnails.roblox.com") {
        return jsonResponse({ data: [{ imageUrl: "https://example.com/icon.webp" }] });
      }
      throw new Error(`Unexpected URL ${url.href}`);
    },
  });

  const previews = await Promise.all(
    Array.from({ length: 12 }, () => context.fetchHomeFriendPreview(12, 34)),
  );
  assert.ok(previews.every((preview) => preview.stats.friends === 7));
  assert.equal(counts.get("users.roblox.com/v1/users/12"), 1);
  assert.equal(counts.get("friends.roblox.com/v1/users/12/friends/count"), 1);
  assert.equal(counts.get("friends.roblox.com/v1/users/12/followers/count"), 1);
  assert.equal(counts.get("friends.roblox.com/v1/users/12/followings/count"), 1);
  assert.equal(counts.get("games.roblox.com/v1/games"), 1);
  assert.equal(counts.get("thumbnails.roblox.com/v1/games/icons"), 1);

  vm.runInContext(
    "for (let index = 0; index < 140; index += 1) writeMemoryCache(homeFriendStableCache, String(index), index, 10000, HOME_FRIEND_PREVIEW_CACHE_LIMIT)",
    context,
  );
  assert.equal(vm.runInContext("homeFriendStableCache.size", context), 128);
});

test("cache storage failures degrade to misses and cleanup uses only indexes", async () => {
  const getArguments = [];
  const failingSession = createStorageArea({
    async get(keys) {
      getArguments.push(keys);
      if (Array.isArray(keys)) throw new Error("session unavailable");
      return {};
    },
    async set() {
      throw new Error("session unavailable");
    },
  });
  const local = createStorageArea({
    async get(keys) {
      getArguments.push(keys);
      return {};
    },
  });
  const context = createHarness({ local, session: failingSession });
  const controller = new AbortController();

  const cached = await context.readCachedRegionsBatch(
    1,
    [{ jobId: "job-00000001" }],
    controller.signal,
  );
  assert.equal(cached.size, 0);
  await context.writeRegionCacheBatch({
    "roblox-server-region:job-00000001": {
      cacheVersion: 3,
      jobId: "job-00000001",
      placeId: 1,
      timestamp: Date.now(),
    },
  });
  await context.cleanupExpiredCache();
  assert.equal(getArguments.some((keys) => keys === null), false);
});

test("critical provider cooldown state restores from storage.session", async () => {
  const now = Date.now();
  const session = createStorageArea({
    async get(key) {
      if (key !== "roblox-server-throttle-state:v1") return {};
      return {
        [key]: {
          currentRegionChecksPerSecond: 5,
          geolocationBlockedUntil: now + 60_000,
          nextRegionRecoveryAt: now + 30_000,
          regionRateLimitedUntil: now + 20_000,
          version: 1,
        },
      };
    },
  });
  const context = createHarness({ session });
  await vm.runInContext("throttleStateRestore", context);
  const restored = vm.runInContext(
    "({ currentRegionChecksPerSecond, geolocationBlockedUntil, regionRateLimitedUntil })",
    context,
  );

  assert.equal(restored.currentRegionChecksPerSecond, 5);
  assert.ok(restored.geolocationBlockedUntil >= now + 60_000);
  assert.ok(restored.regionRateLimitedUntil >= now + 20_000);
});
