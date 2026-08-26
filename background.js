const SERVER_BROWSER_CONFIG = Object.freeze({
  analysisConcurrentRequests: 20,
  cacheTtlMs: 5 * 60 * 1000,
  geolocationCacheTtlMs: 30 * 24 * 60 * 60 * 1000,
  geolocationErrorTtlMs: 10 * 60 * 1000,
  geolocationMaxRetries: 2,
  geolocationRequestsPerSecond: 10,
  initialRegionChecksPerSecond: 8,
  maxRetries: 3,
  minimumRegionChecksPerSecond: 5,
  regionChecksPerSecond: 8,
  regionRateLimitCooldownMs: 30 * 1000,
  regionRateRecoveryStepMs: 5 * 1000,
  retryBaseDelayMs: 700,
  serversPerPage: 100,
});

const CACHE_KEY_PREFIX = "roblox-server-region:";
const CACHE_VERSION = 3;
const DATA_CENTER_LOCATION_CACHE_KEY_PREFIX =
  "roblox-server-datacenter-location:";
const DATA_CENTER_LOCATION_CACHE_VERSION = 1;
const GEOLOCATION_CACHE_KEY_PREFIX = "roblox-server-geolocation:";
const GEOLOCATION_CACHE_VERSION = 1;
const HOME_DISCOVERY_CACHE_TTL_MS = 30 * 1000;
const HOME_FRIEND_PREVIEW_CACHE_TTL_MS = 5 * 60 * 1000;
const PROFILE_BADGE_LIMIT = 16;
const PROFILE_GAME_ENRICHMENT_CACHE_LIMIT = 512;
const PROFILE_GAME_ENRICHMENT_CACHE_TTL_MS = 60 * 1000;
const PROFILE_READ_CACHE_LIMIT = 96;
const PROFILE_READ_CACHE_TTL_MS = Object.freeze({
  avatar: 60 * 1000,
  badges: 60 * 1000,
  bootstrap: 15 * 1000,
  communities: 60 * 1000,
  creations: 60 * 1000,
  favorites: 60 * 1000,
  friends: 20 * 1000,
});
const PROFILE_RESOURCE_CACHE_LIMIT = 96;
const PROFILE_RESOURCE_CACHE_TTL_MS = 60 * 1000;
let lastCacheCleanupAt = 0;
let currentRegionChecksPerSecond =
  SERVER_BROWSER_CONFIG.initialRegionChecksPerSecond;
let nextRegionCheckAt = 0;
let nextRegionRecoveryAt =
  Date.now() + SERVER_BROWSER_CONFIG.regionRateRecoveryStepMs;
let regionCheckGate = Promise.resolve();
let regionRateLimitedUntil = 0;
let geolocationBlockedUntil = 0;
let geolocationGate = Promise.resolve();
let nextGeolocationCheckAt = 0;
const geolocationRequests = new Map();
const dataCenterLocationRequests = new Map();
const homeFriendPreviewCache = new Map();
let homeDiscoveryCache = null;
let homeDiscoveryRequest = null;
let badgeCsrfToken = null;
let profileMutationCsrfToken = null;
let profileMutationGate = Promise.resolve();
let profileAccountEpoch = 0;
let profileAccountKey = null;
let profileReadRevision = 0;
const profileReadCache = new Map();
const profileReadRequests = new Map();
const profileFullAvatarCache = new Map();
const profileFullAvatarRequests = new Map();
const profileGameEnrichmentCache = new Map();
const profileGameEnrichmentRequests = new Map();
const SERVER_ANALYSIS_PORT_NAME = "roblox-server-analysis";
const SERVER_ANALYSIS_RESULT_CHUNK_SIZE = 24;
const SERVER_ANALYSIS_RESULT_FLUSH_MS = 120;
const serverAnalysisOperations = new Map();

class ApiError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: serializeError(error) }));

  return true;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== SERVER_ANALYSIS_PORT_NAME) {
    return;
  }

  let activeOperation = null;

  port.onMessage.addListener((message) => {
    if (message?.type === "START_ANALYSIS") {
      if (activeOperation) {
        cancelServerAnalysis(activeOperation, false);
      }

      try {
        activeOperation = createServerAnalysisOperation(message, port);
      } catch (error) {
        postServerAnalysisMessage(port, {
          error: serializeError(error),
          operationId:
            typeof message?.operationId === "string"
              ? message.operationId
              : null,
          type: "ANALYSIS_ERROR",
        });
        return;
      }

      runServerAnalysis(activeOperation).finally(() => {
        if (activeOperation?.finished) {
          activeOperation = null;
        }
      });
      return;
    }

    if (
      message?.type === "CANCEL_ANALYSIS" &&
      activeOperation?.operationId === message.operationId
    ) {
      cancelServerAnalysis(activeOperation, true);
    }
  });

  port.onDisconnect.addListener(() => {
    if (activeOperation) {
      cancelServerAnalysis(activeOperation, false);
      activeOperation = null;
    }
  });
});

chrome.runtime.onInstalled.addListener(() => {
  cleanupExpiredCache().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  cleanupExpiredCache().catch(() => {});
});

async function handleMessage(message, sender) {
  if (!message || typeof message !== "object") {
    throw new ApiError("INVALID_REQUEST", "La solicitud de la extensión es inválida.");
  }

  if (message.type === "GET_HOME_BOOTSTRAP") {
    return fetchHomeBootstrap();
  }

  if (message.type === "GET_HOME_FRIENDS") {
    return fetchHomeFriends(parseUserId(message.userId));
  }

  if (message.type === "GET_HOME_FRIEND_PREVIEW") {
    return fetchHomeFriendPreview(
      parseUserId(message.userId),
      parseOptionalUniverseId(message.universeId),
    );
  }

  if (message.type === "SEARCH_HOME_USERS") {
    return searchHomeUsers(parseHomeSearchQuery(message.query));
  }

  if (message.type === "GET_HOME_CONTINUE") {
    return fetchHomeContinue();
  }

  if (message.type === "GET_HOME_FAVORITES") {
    return fetchHomeFavorites(parseUserId(message.userId));
  }

  if (message.type === "GET_HOME_RECOMMENDED") {
    return fetchHomeRecommended();
  }

  if (message.type === "GET_PROFILE_BOOTSTRAP") {
    return fetchCachedProfileRead(
      "bootstrap",
      parseUserId(message.userId),
      fetchProfileBootstrap,
    );
  }

  if (message.type === "GET_PROFILE_AVATAR") {
    return fetchCachedProfileRead(
      "avatar",
      parseUserId(message.userId),
      fetchProfileAvatar,
    );
  }

  if (message.type === "GET_PROFILE_CREATIONS") {
    return fetchCachedProfileRead(
      "creations",
      parseUserId(message.userId),
      fetchProfileCreations,
    );
  }

  if (message.type === "GET_PROFILE_FAVORITES") {
    return fetchCachedProfileRead(
      "favorites",
      parseUserId(message.userId),
      fetchProfileFavorites,
    );
  }

  if (message.type === "GET_PROFILE_FRIENDS") {
    return fetchCachedProfileRead(
      "friends",
      parseUserId(message.userId),
      fetchProfileFriends,
    );
  }

  if (message.type === "GET_PROFILE_COMMUNITIES") {
    return fetchCachedProfileRead(
      "communities",
      parseUserId(message.userId),
      fetchProfileCommunities,
    );
  }

  if (message.type === "GET_PROFILE_BADGES") {
    return fetchCachedProfileRead(
      "badges",
      parseUserId(message.userId),
      fetchProfileBadges,
    );
  }

  if (message.type === "REQUEST_PROFILE_FRIEND") {
    const userId = parseUserId(message.userId);
    return queueProfileMutation(() =>
      mutateProfileRelationship(userId, "request-friendship", sender),
    );
  }

  if (message.type === "FOLLOW_PROFILE_USER") {
    const userId = parseUserId(message.userId);
    return queueProfileMutation(() =>
      mutateProfileRelationship(userId, "follow", sender),
    );
  }

  if (message.type === "GET_BADGE_INVENTORY_CONTEXT") {
    return getBadgeInventoryContext(sender);
  }

  if (message.type === "DELETE_INVENTORY_BADGES") {
    return deleteInventoryBadges(parseBadgeIds(message.badgeIds), sender);
  }

  const placeId = parsePlaceId(message.placeId);

  if (message.type === "FETCH_PUBLIC_SERVERS") {
    await maybeCleanupExpiredCache();
    return fetchPublicServers(
      placeId,
      parsePublicServerSortOrder(message.sortOrder),
    );
  }

  if (message.type === "GET_SERVER_REGION") {
    const jobId = parseJobId(message.jobId);
    const tabId = getRobloxTabId(sender);
    return getServerRegion(placeId, jobId, tabId);
  }

  throw new ApiError("UNKNOWN_REQUEST", "La operación solicitada no existe.");
}

async function getBadgeInventoryContext(sender) {
  const inventoryUserId = getInventoryUserIdFromSender(sender);
  const authenticatedUserId = await fetchAuthenticatedUserId();

  return {
    isOwnInventory: inventoryUserId === authenticatedUserId,
    userId: authenticatedUserId,
  };
}

async function deleteInventoryBadges(badgeIds, sender) {
  const inventoryUserId = getInventoryUserIdFromSender(sender);
  const authenticatedUserId = await fetchAuthenticatedUserId();

  if (inventoryUserId !== authenticatedUserId) {
    throw new ApiError(
      "NOT_OWN_INVENTORY",
      "Solo puedes eliminar insignias desde tu propio inventario.",
    );
  }

  const deletedBadgeIds = [];
  const failures = [];

  for (const badgeId of badgeIds) {
    try {
      await deleteOwnBadge(badgeId, inventoryUserId);
      deletedBadgeIds.push(badgeId);
    } catch (error) {
      failures.push({ badgeId, error: serializeError(error) });
    }
  }

  return { deletedBadgeIds, failures };
}

function createServerAnalysisOperation(message, port) {
  const operationId = parseServerAnalysisOperationId(message.operationId);
  const placeId = parsePlaceId(message.placeId);
  const tabId = getRobloxTabId(port.sender);
  const existingOperation = serverAnalysisOperations.get(operationId);

  if (existingOperation) {
    cancelServerAnalysis(existingOperation, false);
  }

  const operation = {
    activeTasks: 0,
    cachedCount: 0,
    controller: new AbortController(),
    dataCenterLocationRequests: new Map(),
    failedCount: 0,
    failureBuffer: [],
    finished: false,
    flushTimer: null,
    ipLocationRequests: new Map(),
    operationId,
    pagePromises: [],
    pagesFetched: 0,
    paginationComplete: false,
    placeId,
    port,
    processedCount: 0,
    queue: [],
    requestKeys: new Set(),
    resultBuffer: [],
    sortOrder: parsePublicServerSortOrder(message.sortOrder),
    tabId,
    totalCount: 0,
  };

  serverAnalysisOperations.set(operationId, operation);
  return operation;
}

async function runServerAnalysis(operation) {
  const { signal } = operation.controller;

  postServerAnalysisMessage(operation.port, {
    limits: {
      concurrentRequests: SERVER_BROWSER_CONFIG.analysisConcurrentRequests,
      serversPerPage: SERVER_BROWSER_CONFIG.serversPerPage,
    },
    operationId: operation.operationId,
    type: "ANALYSIS_STARTED",
  });

  try {
    await maybeCleanupExpiredCache().catch(() => {});
    let cursor = null;
    const requestedCursors = new Set();

    do {
      throwIfAnalysisAborted(signal);
      const cursorKey = cursor || "__first_page__";

      if (requestedCursors.has(cursorKey)) {
        throw new ApiError(
          "PAGINATION_LOOP",
          "Roblox repitió un cursor de paginación y se detuvo el análisis para evitar un bucle.",
        );
      }

      requestedCursors.add(cursorKey);
      const page = await fetchPublicServerPage(
        operation.placeId,
        cursor,
        operation.sortOrder,
        signal,
      );
      const pageServers = [];

      page.servers.forEach((server) => {
        const requestKey = `${operation.placeId}:${server.jobId}`;

        if (!operation.requestKeys.has(requestKey)) {
          operation.requestKeys.add(requestKey);
          pageServers.push(server);
        }
      });

      operation.pagesFetched += 1;
      operation.totalCount += pageServers.length;
      cursor = page.nextPageCursor;
      postServerAnalysisProgress(operation);
      const pagePromise = analyzePublicServerPage(operation, pageServers);
      pagePromise.catch(() => {});
      operation.pagePromises.push(pagePromise);
    } while (cursor);

    operation.paginationComplete = true;
    postServerAnalysisProgress(operation);
    await Promise.all(operation.pagePromises);
    throwIfAnalysisAborted(signal);
    flushServerAnalysisResults(operation);
    operation.finished = true;
    postServerAnalysisMessage(operation.port, {
      ...getServerAnalysisStats(operation),
      operationId: operation.operationId,
      type: "ANALYSIS_COMPLETE",
    });
  } catch (error) {
    if (isAnalysisCancellation(error, signal)) {
      if (!operation.finished) {
        operation.finished = true;
        postServerAnalysisMessage(operation.port, {
          ...getServerAnalysisStats(operation),
          operationId: operation.operationId,
          type: "ANALYSIS_CANCELLED",
        });
      }
    } else {
      cancelServerAnalysis(operation, false);
      operation.finished = true;
      postServerAnalysisMessage(operation.port, {
        error: serializeError(error),
        operationId: operation.operationId,
        type: "ANALYSIS_ERROR",
      });
    }
  } finally {
    if (operation.flushTimer !== null) {
      clearTimeout(operation.flushTimer);
      operation.flushTimer = null;
    }

    if (serverAnalysisOperations.get(operation.operationId) === operation) {
      serverAnalysisOperations.delete(operation.operationId);
    }
  }
}

async function fetchPublicServerPage(placeId, cursor, sortOrder, signal) {
  const url = new URL(
    `https://games.roblox.com/v1/games/${placeId}/servers/Public`,
  );
  url.searchParams.set("sortOrder", sortOrder);
  url.searchParams.set("excludeFullGames", "true");
  url.searchParams.set("limit", String(SERVER_BROWSER_CONFIG.serversPerPage));

  if (cursor) {
    url.searchParams.set("cursor", cursor);
  }

  const payload = await fetchJsonWithRetry(url.href, {
    credentials: "include",
    headers: { Accept: "application/json" },
    signal,
  });

  if (!payload || !Array.isArray(payload.data)) {
    throw new ApiError(
      "INVALID_SERVER_RESPONSE",
      "Roblox devolvió una lista de servidores inválida.",
    );
  }

  return {
    nextPageCursor:
      typeof payload.nextPageCursor === "string" && payload.nextPageCursor
        ? payload.nextPageCursor
        : null,
    servers: payload.data.map(normalizePublicServer).filter(Boolean),
  };
}

async function analyzePublicServerPage(operation, publicServers) {
  if (!publicServers.length) {
    return;
  }

  const { signal } = operation.controller;
  const cachedRegions = await readCachedRegionsBatch(
    operation.placeId,
    publicServers,
    signal,
  );
  const cacheWrites = {};
  const tasks = publicServers.map((server) =>
    enqueueServerAnalysisTask(operation, async () => {
      try {
        const cached = cachedRegions.get(server.jobId);
        let details;

        if (cached) {
          const location = await getAnalysisDataCenterLocation(
            operation,
            cached.dataCenterId,
            cached.endpointAddress,
          );
          details = { ...cached, cached: true, location };
          operation.cachedCount += 1;
        } else {
          const fresh = await fetchFreshServerRegionForAnalysis(
            operation,
            server.jobId,
          );
          details = fresh.details;
          cacheWrites[getCacheKey(server.jobId)] = fresh.cacheEntry;
        }

        queueServerAnalysisResult(operation, {
          ...server,
          location: details.location,
        });
      } catch (error) {
        if (isAnalysisCancellation(error, signal)) {
          throw error;
        }

        operation.failedCount += 1;
        operation.failureBuffer.push({
          jobId: server.jobId,
          reason:
            error?.details?.cause ||
            error?.message ||
            "La comprobación regional falló.",
        });
      } finally {
        if (!signal.aborted) {
          operation.processedCount += 1;
          scheduleServerAnalysisFlush(operation);
        }
      }
    }),
  );

  await Promise.all(tasks);
  throwIfAnalysisAborted(signal);

  if (Object.keys(cacheWrites).length) {
    await writeLocalCache(cacheWrites);
  }
}

function enqueueServerAnalysisTask(operation, task) {
  const { signal } = operation.controller;

  if (signal.aborted) {
    return Promise.reject(createAnalysisCancellationError());
  }

  return new Promise((resolve, reject) => {
    operation.queue.push({ reject, resolve, task });
    pumpServerAnalysisQueue(operation);
  });
}

function pumpServerAnalysisQueue(operation) {
  const { signal } = operation.controller;

  if (signal.aborted) {
    const cancellation = createAnalysisCancellationError();
    operation.queue.splice(0).forEach(({ reject }) => reject(cancellation));
    return;
  }

  while (
    operation.activeTasks < SERVER_BROWSER_CONFIG.analysisConcurrentRequests &&
    operation.queue.length
  ) {
    const queued = operation.queue.shift();
    operation.activeTasks += 1;

    Promise.resolve()
      .then(() => {
        throwIfAnalysisAborted(signal);
        return queued.task();
      })
      .then(queued.resolve, queued.reject)
      .finally(() => {
        operation.activeTasks -= 1;
        pumpServerAnalysisQueue(operation);
      });
  }
}

async function readCachedRegionsBatch(placeId, servers, signal) {
  throwIfAnalysisAborted(signal);
  const keys = servers.map((server) => getCacheKey(server.jobId));
  let stored;

  try {
    stored = await chrome.storage.local.get(keys);
  } catch {
    return new Map();
  }

  throwIfAnalysisAborted(signal);
  const cached = new Map();
  const expiredKeys = [];

  servers.forEach((server) => {
    const key = getCacheKey(server.jobId);
    const entry = stored[key];

    if (
      entry?.cacheVersion === CACHE_VERSION &&
      entry.placeId === placeId &&
      entry.jobId === server.jobId &&
      Number.isFinite(entry.timestamp) &&
      Date.now() - entry.timestamp <= SERVER_BROWSER_CONFIG.cacheTtlMs
    ) {
      cached.set(server.jobId, {
        dataCenterId: toNullableInteger(entry.dataCenterId),
        endpointAddress: normalizeIpAddress(entry.endpointAddress),
        jobId: server.jobId,
        placeId,
        region: normalizeRegion(entry.region),
        timestamp: entry.timestamp,
      });
    } else if (entry) {
      expiredKeys.push(key);
    }
  });

  if (expiredKeys.length && !signal.aborted) {
    chrome.storage.local.remove(expiredKeys).catch(() => {});
  }

  return cached;
}

async function fetchFreshServerRegionForAnalysis(operation, jobId) {
  const { signal } = operation.controller;
  const payload = await fetchJoinPayloadWithRetry(
    operation.placeId,
    jobId,
    operation.tabId,
    signal,
    operation.operationId,
  );
  const joinScript = payload?.joinScript;

  if (!joinScript || typeof joinScript !== "object") {
    const message = typeof payload?.message === "string" ? payload.message : "";
    const isUnavailable =
      payload?.status === 12 ||
      payload?.status === 22 ||
      /unable to join|full|shut down|no longer available/i.test(message);

    throw new ApiError(
      isUnavailable ? "SERVER_UNAVAILABLE" : "INVALID_JOIN_RESPONSE",
      isUnavailable
        ? "El servidor ya no está disponible."
        : "Roblox no devolvió un joinScript válido.",
      { robloxMessage: message, robloxStatus: payload?.status ?? null },
    );
  }

  const region = normalizeRegion(joinScript.GameJoinRegion);
  const dataCenterId = toNullableInteger(joinScript.DataCenterId);
  const endpointAddress = normalizeIpAddress(joinScript.UdmuxAddress);

  if (!region && dataCenterId === null) {
    throw new ApiError(
      "MISSING_REGION",
      "Roblox no informó la región ni el datacenter de este servidor.",
    );
  }

  const cacheEntry = {
    cacheVersion: CACHE_VERSION,
    dataCenterId,
    endpointAddress,
    jobId,
    placeId: operation.placeId,
    region,
    timestamp: Date.now(),
  };
  const location = await getAnalysisDataCenterLocation(
    operation,
    dataCenterId,
    endpointAddress,
  );

  throwIfAnalysisAborted(signal);
  return {
    cacheEntry,
    details: { ...cacheEntry, cached: false, location },
  };
}

async function getAnalysisDataCenterLocation(
  operation,
  dataCenterId,
  address,
) {
  const key = dataCenterId === null ? `ip:${address || "none"}` : dataCenterId;
  const existing = operation.dataCenterLocationRequests.get(key);

  if (existing) {
    return existing;
  }

  const request = (async () => {
    const { signal } = operation.controller;
    throwIfAnalysisAborted(signal);

    if (dataCenterId !== null) {
      const cached = await readCachedDataCenterLocation(dataCenterId, signal);
      throwIfAnalysisAborted(signal);

      if (cached.hit) {
        return cached.location;
      }
    }

    if (!address) {
      return null;
    }

    const location = await getAnalysisIpLocation(operation, address);
    throwIfAnalysisAborted(signal);

    if (dataCenterId !== null) {
      await writeCachedDataCenterLocation(
        dataCenterId,
        location,
        location
          ? SERVER_BROWSER_CONFIG.geolocationCacheTtlMs
          : SERVER_BROWSER_CONFIG.geolocationErrorTtlMs,
      );
    }

    return location;
  })();

  operation.dataCenterLocationRequests.set(key, request);

  try {
    return await request;
  } finally {
    operation.dataCenterLocationRequests.delete(key);
  }
}

async function getAnalysisIpLocation(operation, address) {
  const existing = operation.ipLocationRequests.get(address);

  if (existing) {
    return existing;
  }

  const request = (async () => {
    const { signal } = operation.controller;
    throwIfAnalysisAborted(signal);
    const cached = await readCachedGeolocation(address, signal);
    throwIfAnalysisAborted(signal);

    if (cached.hit) {
      return cached.location;
    }

    if (Date.now() < geolocationBlockedUntil) {
      return null;
    }

    return fetchIpLocationForAnalysis(address, signal);
  })();

  operation.ipLocationRequests.set(address, request);

  try {
    return await request;
  } finally {
    operation.ipLocationRequests.delete(address);
  }
}

async function fetchIpLocationForAnalysis(address, signal) {
  const url = new URL(`https://ipwho.is/${encodeURIComponent(address)}`);
  url.searchParams.set(
    "fields",
    "success,message,ip,continent,country,country_code,region,city,latitude,longitude",
  );
  url.searchParams.set("lang", "es");

  for (
    let attempt = 0;
    attempt <= SERVER_BROWSER_CONFIG.geolocationMaxRetries;
    attempt += 1
  ) {
    throwIfAnalysisAborted(signal);

    if (Date.now() < geolocationBlockedUntil) {
      return null;
    }

    await waitForGeolocationSlot(signal);
    throwIfAnalysisAborted(signal);

    let response;

    try {
      response = await fetch(url.href, {
        credentials: "omit",
        headers: { Accept: "application/json" },
        referrerPolicy: "no-referrer",
        signal,
      });
    } catch (error) {
      if (isAnalysisCancellation(error, signal)) {
        throw createAnalysisCancellationError();
      }

      if (attempt < SERVER_BROWSER_CONFIG.geolocationMaxRetries) {
        await abortableDelay(getBackoffDelay(attempt), signal);
        continue;
      }

      throwIfAnalysisAborted(signal);
      await writeCachedGeolocation(
        address,
        null,
        SERVER_BROWSER_CONFIG.geolocationErrorTtlMs,
      );
      return null;
    }

    if (response.status === 429) {
      geolocationBlockedUntil =
        Date.now() +
        getRetryAfterDurationMs(
          response.headers.get("Retry-After"),
          24 * 60 * 60 * 1000,
        );
      throwIfAnalysisAborted(signal);
      await writeCachedGeolocation(
        address,
        null,
        SERVER_BROWSER_CONFIG.geolocationErrorTtlMs,
      );
      return null;
    }

    if (response.status >= 500 && attempt < SERVER_BROWSER_CONFIG.geolocationMaxRetries) {
      await abortableDelay(getBackoffDelay(attempt), signal);
      continue;
    }

    let location = null;

    if (response.ok) {
      try {
        location = normalizeIpLocation(await response.json(), address);
      } catch {
        location = null;
      }
    }

    throwIfAnalysisAborted(signal);
    await writeCachedGeolocation(
      address,
      location,
      location
        ? SERVER_BROWSER_CONFIG.geolocationCacheTtlMs
        : SERVER_BROWSER_CONFIG.geolocationErrorTtlMs,
    );
    return location;
  }

  return null;
}

function queueServerAnalysisResult(operation, server) {
  if (operation.finished || operation.controller.signal.aborted) {
    return;
  }

  operation.resultBuffer.push(server);

  if (
    operation.resultBuffer.length + operation.failureBuffer.length >=
    SERVER_ANALYSIS_RESULT_CHUNK_SIZE
  ) {
    flushServerAnalysisResults(operation);
  } else {
    scheduleServerAnalysisFlush(operation);
  }
}

function scheduleServerAnalysisFlush(operation) {
  if (operation.flushTimer !== null || operation.finished) {
    return;
  }

  operation.flushTimer = setTimeout(() => {
    operation.flushTimer = null;
    flushServerAnalysisResults(operation);
  }, SERVER_ANALYSIS_RESULT_FLUSH_MS);
}

function flushServerAnalysisResults(operation) {
  if (operation.controller.signal.aborted) {
    operation.resultBuffer.length = 0;
    operation.failureBuffer.length = 0;
    return;
  }

  if (!operation.resultBuffer.length && !operation.failureBuffer.length) {
    postServerAnalysisProgress(operation);
    return;
  }

  const results = operation.resultBuffer.splice(0);
  const failures = operation.failureBuffer.splice(0);
  postServerAnalysisMessage(operation.port, {
    ...getServerAnalysisStats(operation),
    failures,
    operationId: operation.operationId,
    results,
    type: "ANALYSIS_RESULTS",
  });
}

function postServerAnalysisProgress(operation) {
  postServerAnalysisMessage(operation.port, {
    ...getServerAnalysisStats(operation),
    operationId: operation.operationId,
    type: "ANALYSIS_PROGRESS",
  });
}

function getServerAnalysisStats(operation) {
  return {
    cachedCount: operation.cachedCount,
    failedCount: operation.failedCount,
    pagesFetched: operation.pagesFetched,
    paginationComplete: operation.paginationComplete,
    processedCount: operation.processedCount,
    totalCount: operation.totalCount,
  };
}

function cancelServerAnalysis(operation, notify) {
  if (operation.finished) {
    return;
  }

  operation.controller.abort();
  if (operation.flushTimer !== null) {
    clearTimeout(operation.flushTimer);
    operation.flushTimer = null;
  }
  operation.resultBuffer.length = 0;
  operation.failureBuffer.length = 0;
  const cancellation = createAnalysisCancellationError();
  operation.queue.splice(0).forEach(({ reject }) => reject(cancellation));
  abortMainWorldAnalysisRequests(
    operation.tabId,
    operation.operationId,
  ).catch(() => {});

  if (notify) {
    operation.finished = true;
    postServerAnalysisMessage(operation.port, {
      ...getServerAnalysisStats(operation),
      operationId: operation.operationId,
      type: "ANALYSIS_CANCELLED",
    });
  }
}

async function abortMainWorldAnalysisRequests(tabId, operationId) {
  await chrome.scripting.executeScript({
    args: [operationId],
    func: (requestOperationId) => {
      const registry = globalThis.__robloxExtensionServerAnalysisControllers;
      const controllers = registry?.get(requestOperationId);

      if (controllers) {
        controllers.forEach((controller) => controller.abort());
        registry.delete(requestOperationId);
      }
    },
    target: { tabId },
    world: "MAIN",
  });
}

function postServerAnalysisMessage(port, message) {
  try {
    port.postMessage(message);
  } catch {
    // A disconnected Port is equivalent to cancellation.
  }
}

function parseServerAnalysisOperationId(value) {
  if (
    typeof value !== "string" ||
    value.length < 8 ||
    value.length > 100 ||
    !/^[a-zA-Z0-9_-]+$/.test(value)
  ) {
    throw new ApiError(
      "INVALID_OPERATION_ID",
      "El identificador del análisis no es válido.",
    );
  }

  return value;
}

function createAnalysisCancellationError() {
  return new ApiError(
    "OPERATION_CANCELLED",
    "El análisis de servidores fue cancelado.",
  );
}

function throwIfAnalysisAborted(signal) {
  if (signal?.aborted) {
    throw createAnalysisCancellationError();
  }
}

function isAnalysisCancellation(error, signal) {
  return (
    signal?.aborted ||
    error?.code === "OPERATION_CANCELLED" ||
    error?.name === "AbortError"
  );
}

function abortableDelay(milliseconds, signal) {
  if (!signal) {
    return delay(milliseconds);
  }

  throwIfAnalysisAborted(signal);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, milliseconds);
    const handleAbort = () => {
      clearTimeout(timer);
      reject(createAnalysisCancellationError());
    };
    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

async function fetchAuthenticatedUserId() {
  const payload = await fetchJsonWithRetry(
    "https://users.roblox.com/v1/users/authenticated",
    {
      credentials: "include",
      headers: { Accept: "application/json" },
    },
  );
  const userId = Number(payload?.id);

  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new ApiError(
      "INVALID_USER_RESPONSE",
      "Roblox devolvió un usuario autenticado inválido.",
    );
  }

  return userId;
}

async function deleteOwnBadge(badgeId, inventoryUserId) {
  let csrfRefreshes = 0;
  let shouldRevalidateUser = false;
  let transientAttempts = 0;

  while (transientAttempts <= SERVER_BROWSER_CONFIG.maxRetries) {
    let response;

    try {
      if (shouldRevalidateUser) {
        const authenticatedUserId = await fetchAuthenticatedUserId();

        if (inventoryUserId !== authenticatedUserId) {
          throw new ApiError(
            "NOT_OWN_INVENTORY",
            "Solo puedes eliminar insignias desde tu propio inventario.",
          );
        }
      }

      const headers = { Accept: "application/json" };

      if (badgeCsrfToken) {
        headers["X-CSRF-TOKEN"] = badgeCsrfToken;
      }

      response = await fetch(
        `https://badges.roblox.com/v1/user/badges/${badgeId}`,
        {
          method: "DELETE",
          credentials: "include",
          headers,
        },
      );
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }

      if (transientAttempts === SERVER_BROWSER_CONFIG.maxRetries) {
        throw new ApiError(
          "NETWORK_ERROR",
          "No se pudo conectar con la API de insignias de Roblox.",
          { cause: error?.message ?? "" },
        );
      }

      await delay(getBackoffDelay(transientAttempts));
      shouldRevalidateUser = true;
      transientAttempts += 1;
      continue;
    }

    if (response.status === 403) {
      const nextCsrfToken = response.headers.get("x-csrf-token");

      if (
        nextCsrfToken &&
        nextCsrfToken !== badgeCsrfToken &&
        csrfRefreshes < 2
      ) {
        badgeCsrfToken = nextCsrfToken;
        csrfRefreshes += 1;
        shouldRevalidateUser = true;
        continue;
      }
    }

    if (response.ok || response.status === 404) {
      return;
    }

    if (
      (response.status === 429 || response.status >= 500) &&
      transientAttempts < SERVER_BROWSER_CONFIG.maxRetries
    ) {
      await delay(getRetryDelay(response, transientAttempts));
      shouldRevalidateUser = true;
      transientAttempts += 1;
      continue;
    }

    if (response.status === 401) {
      throw new ApiError(
        "AUTH_REQUIRED",
        "Inicia sesión nuevamente en Roblox para eliminar insignias.",
        { httpStatus: response.status },
      );
    }

    if (response.status === 403) {
      throw new ApiError(
        "BADGE_DELETE_FORBIDDEN",
        "Roblox rechazó la autorización para eliminar esta insignia.",
        { httpStatus: response.status },
      );
    }

    throw new ApiError(
      response.status === 429
        ? "RATE_LIMITED"
        : response.status >= 500
          ? "ROBLOX_UNAVAILABLE"
          : "BADGE_DELETE_FAILED",
      response.status === 429
        ? "Roblox limitó temporalmente la eliminación de insignias."
        : response.status >= 500
          ? "La API de insignias de Roblox no está disponible temporalmente."
        : `No se pudo eliminar la insignia (HTTP ${response.status}).`,
      { httpStatus: response.status },
    );
  }
}

function getInventoryUserIdFromSender(sender) {
  let pathname;

  try {
    pathname = new URL(sender?.url ?? "").pathname;
  } catch {
    pathname = "";
  }

  const match = pathname.match(
    /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?users\/(\d+)\/inventory\/?$/i,
  );
  const userId = Number(match?.[1]);

  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new ApiError(
      "INVALID_INVENTORY_PAGE",
      "La solicitud no proviene de un inventario válido de Roblox.",
    );
  }

  return userId;
}

function parseBadgeIds(value) {
  if (
    !Array.isArray(value) ||
    value.length !== 1 ||
    typeof value[0] !== "number" ||
    !Number.isSafeInteger(value[0]) ||
    value[0] <= 0
  ) {
    throw new ApiError(
      "INVALID_BADGE_IDS",
      "La solicitud debe contener una insignia válida.",
    );
  }

  return value;
}

async function fetchHomeBootstrap() {
  const payload = await fetchJsonWithRetry(
    "https://users.roblox.com/v1/users/authenticated",
    {
      credentials: "include",
      headers: { Accept: "application/json" },
    },
  );
  const id = Number(payload?.id);
  const username = normalizeHomeText(payload?.name, 20);
  const displayName = normalizeHomeText(payload?.displayName, 50);

  if (!Number.isSafeInteger(id) || id <= 0 || !username || !displayName) {
    throw new ApiError(
      "INVALID_USER_RESPONSE",
      "Roblox devolvió datos inválidos para el usuario autenticado.",
    );
  }

  const [avatarUrl, robux] = await Promise.all([
    fetchUserHeadshot(id),
    fetchUserRobux(),
  ]);

  return {
    user: {
      avatarUrl,
      displayName,
      id,
      robux,
      username,
    },
  };
}

async function fetchUserRobux() {
  try {
    const payload = await fetchJsonWithRetry(
      "https://economy.roblox.com/v1/user/currency",
      {
        credentials: "include",
        headers: { Accept: "application/json" },
      },
    );
    const robux = payload?.robux;

    return Number.isSafeInteger(robux) && robux >= 0 ? robux : null;
  } catch {
    // The profile remains usable when the balance endpoint is unavailable.
    return null;
  }
}

async function fetchUserHeadshot(userId) {
  const url = new URL("https://thumbnails.roblox.com/v1/users/avatar-headshot");
  url.searchParams.set("userIds", String(userId));
  url.searchParams.set("size", "150x150");
  url.searchParams.set("format", "Webp");
  url.searchParams.set("isCircular", "true");

  try {
    const payload = await fetchJsonWithRetry(url.href, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    const imageUrl = payload?.data?.[0]?.imageUrl;

    if (typeof imageUrl === "string" && /^https:\/\//i.test(imageUrl)) {
      return imageUrl;
    }
  } catch {
    // The account data remains useful when Roblox has not generated a thumbnail.
  }

  return null;
}

function normalizeHomeText(value, maximumLength) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, maximumLength);
}

async function fetchHomeFriends(userId) {
  const payload = await fetchJsonWithRetry(
    `https://friends.roblox.com/v1/users/${userId}/friends`,
    {
      credentials: "include",
      headers: { Accept: "application/json" },
    },
  );

  if (!payload || !Array.isArray(payload.data)) {
    throw new ApiError(
      "INVALID_FRIENDS_RESPONSE",
      "Roblox devolvió una lista de amigos inválida.",
    );
  }

  const userIds = [
    ...new Set(
      payload.data
        .map((friend) => Number(friend?.id))
        .filter((id) => Number.isSafeInteger(id) && id > 0),
    ),
  ];

  if (!userIds.length) {
    return { count: 0, friends: [] };
  }

  const [profiles, presences, thumbnails, customNames] = await Promise.all([
    fetchFriendProfiles(userIds),
    fetchFriendPresences(userIds).catch(() => []),
    fetchFriendThumbnails(userIds).catch(() => []),
    fetchFriendCustomNames(userIds).catch(() => []),
  ]);
  const presenceByUserId = new Map(
    presences.map((presence) => [Number(presence?.userId), presence]),
  );
  const thumbnailByUserId = new Map(
    thumbnails.map((thumbnail) => [Number(thumbnail?.targetId), thumbnail]),
  );
  const customNameByUserId = new Map(
    customNames.map((tag) => [Number(tag?.targetUserId), tag?.targetUserTag]),
  );
  const friends = profiles
    .map((profile) =>
      normalizeHomeFriend(
        profile,
        presenceByUserId.get(Number(profile?.id)),
        thumbnailByUserId.get(Number(profile?.id)),
        customNameByUserId.get(Number(profile?.id)),
      ),
    )
    .filter(Boolean)
    .sort(compareHomeFriends);

  return {
    count: userIds.length,
    friends: friends.slice(0, 7),
  };
}

async function fetchFriendProfiles(userIds) {
  const responses = await Promise.all(
    chunkValues(userIds, 50).map((batch) =>
      fetchJsonWithRetry("https://users.roblox.com/v1/users", {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          excludeBannedUsers: true,
          userIds: batch,
        }),
      }),
    ),
  );

  if (responses.some((payload) => !Array.isArray(payload?.data))) {
    throw new ApiError(
      "INVALID_FRIEND_PROFILES_RESPONSE",
      "Roblox devolvió perfiles de amigos inválidos.",
    );
  }

  return responses.flatMap((payload) => payload.data);
}

async function fetchFriendPresences(userIds) {
  const responses = await Promise.all(
    chunkValues(userIds, 50).map((batch) =>
      fetchJsonWithRetry("https://presence.roblox.com/v1/presence/users", {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ userIds: batch }),
      }),
    ),
  );

  return responses.flatMap((payload) =>
    Array.isArray(payload?.userPresences) ? payload.userPresences : [],
  );
}

async function fetchFriendThumbnails(userIds) {
  const responses = await Promise.all(
    chunkValues(userIds, 50).map((batch) => {
      const url = new URL(
        "https://thumbnails.roblox.com/v1/users/avatar-headshot",
      );
      url.searchParams.set("userIds", batch.join(","));
      url.searchParams.set("size", "150x150");
      url.searchParams.set("format", "Webp");
      url.searchParams.set("isCircular", "true");

      return fetchJsonWithRetry(url.href, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
    }),
  );

  return responses.flatMap((payload) =>
    Array.isArray(payload?.data) ? payload.data : [],
  );
}

async function fetchFriendCustomNames(userIds) {
  const responses = await Promise.all(
    chunkValues(userIds, 50).map((batch) =>
      fetchJsonWithRetry("https://contacts.roblox.com/v1/user/get-tags", {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ targetUserIds: batch }),
      }),
    ),
  );

  return responses.flatMap((payload) => (Array.isArray(payload) ? payload : []));
}

async function searchHomeUsers(query) {
  const url = new URL("https://users.roblox.com/v1/users/search");
  url.searchParams.set("keyword", query);
  url.searchParams.set("limit", "10");

  const payload = await fetchJsonWithRetry(url.href, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });

  if (!Array.isArray(payload?.data)) {
    throw new ApiError(
      "INVALID_USER_SEARCH_RESPONSE",
      "Roblox devolvió resultados de búsqueda inválidos.",
    );
  }

  const profiles = payload.data
    .map(normalizeHomeSearchUser)
    .filter(Boolean)
    .slice(0, 8);
  const thumbnails = profiles.length
    ? await fetchFriendThumbnails(profiles.map((profile) => profile.id)).catch(
        () => [],
      )
    : [];
  const thumbnailByUserId = new Map(
    thumbnails.map((thumbnail) => [Number(thumbnail?.targetId), thumbnail]),
  );

  return {
    query,
    users: profiles.map((profile) => {
      const imageUrl = thumbnailByUserId.get(profile.id)?.imageUrl;

      return {
        ...profile,
        avatarUrl:
          typeof imageUrl === "string" && /^https:\/\//i.test(imageUrl)
            ? imageUrl
            : null,
      };
    }),
  };
}

function normalizeHomeSearchUser(profile) {
  const id = Number(profile?.id);
  const username = normalizeHomeText(profile?.name, 20);
  const displayName = normalizeHomeText(profile?.displayName, 50);

  if (!Number.isSafeInteger(id) || id <= 0 || !username || !displayName) {
    return null;
  }

  return {
    displayName,
    id,
    previousUsernames: Array.isArray(profile?.previousUsernames)
      ? profile.previousUsernames
          .map((name) => normalizeHomeText(name, 20))
          .filter(Boolean)
          .slice(0, 3)
      : [],
    username,
  };
}

async function fetchHomeContinue() {
  const payload = await fetchHomeDiscoveryFeed();

  const continueSort = payload.sorts.find(
    (sort) =>
      normalizeHomeText(sort?.topic, 50).toLocaleLowerCase() === "continue" ||
      Number(sort?.topicId) === 100000003,
  );
  const recommendations = Array.isArray(continueSort?.recommendationList)
    ? continueSort.recommendationList
    : [];
  const metadata = payload?.contentMetadata?.Game;
  const games = recommendations
    .map((recommendation) => {
      const universeId = Number(recommendation?.contentId);
      const game =
        metadata && typeof metadata === "object"
          ? metadata[String(universeId)]
          : null;

      return normalizeHomeDiscoveryGame(universeId, game);
    })
    .filter(Boolean)
    .slice(0, 30);
  const icons = games.length
    ? await fetchHomeGameIcons(games.map((game) => game.universeId)).catch(
        () => [],
      )
    : [];
  const iconByUniverseId = new Map(
    icons.map((icon) => [Number(icon?.targetId), icon?.imageUrl]),
  );

  return {
    games: games.map((game) => {
      const imageUrl = iconByUniverseId.get(game.universeId);

      return {
        ...game,
        imageUrl:
          typeof imageUrl === "string" && /^https:\/\//i.test(imageUrl)
            ? imageUrl
            : null,
      };
    }),
  };
}

async function fetchHomeDiscoveryFeed() {
  if (
    homeDiscoveryCache &&
    Date.now() - homeDiscoveryCache.timestamp < HOME_DISCOVERY_CACHE_TTL_MS
  ) {
    return homeDiscoveryCache.value;
  }

  if (homeDiscoveryRequest) {
    return homeDiscoveryRequest;
  }

  homeDiscoveryRequest = fetchJsonWithRetry(
    "https://apis.roblox.com/discovery-api/omni-recommendation",
    {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pageType: "Home",
        sessionId: crypto.randomUUID(),
        supportedTreatmentTypes: ["SortlessGrid"],
        sduiTreatmentTypes: ["Carousel", "HeroUnit"],
      }),
    },
  )
    .then((payload) => {
      if (!Array.isArray(payload?.sorts)) {
        throw new ApiError(
          "INVALID_HOME_DISCOVERY_RESPONSE",
          "Roblox devolvió un feed de inicio inválido.",
        );
      }

      homeDiscoveryCache = { timestamp: Date.now(), value: payload };
      return payload;
    })
    .finally(() => {
      homeDiscoveryRequest = null;
    });

  return homeDiscoveryRequest;
}

async function fetchHomeRecommended() {
  const payload = await fetchHomeDiscoveryFeed();
  const recommendedSort = payload.sorts.find(
    (sort) =>
      (Number(sort?.topicId) === 100000000 ||
        normalizeHomeText(sort?.topic, 50).toLocaleLowerCase() ===
          "recommended for you") &&
      Array.isArray(sort?.recommendationList) &&
      sort.recommendationList.length > 0,
  );
  const recommendations = Array.isArray(recommendedSort?.recommendationList)
    ? recommendedSort.recommendationList
    : [];
  const metadata = payload?.contentMetadata?.Game;
  const seenUniverseIds = new Set();
  const games = recommendations
    .filter((recommendation) => recommendation?.contentType === "Game")
    .map((recommendation) => {
      const universeId = Number(recommendation?.contentId);

      if (seenUniverseIds.has(universeId)) {
        return null;
      }

      seenUniverseIds.add(universeId);
      const game =
        metadata && typeof metadata === "object"
          ? metadata[String(universeId)]
          : null;
      return normalizeHomeDiscoveryGame(universeId, game);
    })
    .filter(Boolean)
    .slice(0, 50);
  const thumbnails = games.length
    ? await fetchHomeGameThumbnails(
        games.map((game) => game.universeId),
      ).catch(() => [])
    : [];
  const thumbnailByUniverseId = new Map(
    thumbnails.map((thumbnail) => [
      Number(thumbnail?.universeId),
      thumbnail?.thumbnails?.[0]?.imageUrl,
    ]),
  );

  return {
    games: games.map((game) => {
      const imageUrl = thumbnailByUniverseId.get(game.universeId);

      return {
        ...game,
        imageUrl:
          typeof imageUrl === "string" && /^https:\/\//i.test(imageUrl)
            ? imageUrl
            : null,
      };
    }),
  };
}

function normalizeHomeDiscoveryGame(universeId, game) {
  const name = normalizeHomeText(game?.name, 120);
  const placeId = Number(game?.rootPlaceId);
  const playerCount = Number(game?.playerCount);
  const upVotes = Number(game?.totalUpVotes);
  const downVotes = Number(game?.totalDownVotes);
  const totalVotes = upVotes + downVotes;

  if (
    !Number.isSafeInteger(universeId) ||
    universeId <= 0 ||
    !Number.isSafeInteger(placeId) ||
    placeId <= 0 ||
    !name
  ) {
    return null;
  }

  return {
    name,
    placeId,
    playerCount:
      Number.isSafeInteger(playerCount) && playerCount >= 0 ? playerCount : 0,
    rating:
      Number.isSafeInteger(upVotes) &&
      upVotes >= 0 &&
      Number.isSafeInteger(downVotes) &&
      downVotes >= 0 &&
      totalVotes > 0
        ? Math.round((upVotes / totalVotes) * 100)
        : null,
    universeId,
  };
}

async function fetchHomeGameThumbnails(universeIds) {
  const responses = await Promise.all(
    chunkValues(universeIds, 20).map((batch) => {
      const url = new URL(
        "https://thumbnails.roblox.com/v1/games/multiget/thumbnails",
      );
      url.searchParams.set("universeIds", batch.join(","));
      url.searchParams.set("countPerUniverse", "1");
      url.searchParams.set("defaults", "true");
      url.searchParams.set("size", "384x216");
      url.searchParams.set("format", "Webp");
      url.searchParams.set("isCircular", "false");

      return fetchJsonWithRetry(url.href, {
        headers: { Accept: "application/json" },
      });
    }),
  );

  return responses.flatMap((response) =>
    Array.isArray(response?.data) ? response.data : [],
  );
}

async function fetchHomeGameIcons(universeIds) {
  const responses = await Promise.all(
    chunkValues(universeIds, 50).map((batch) => {
      const url = new URL("https://thumbnails.roblox.com/v1/games/icons");
      url.searchParams.set("universeIds", batch.join(","));
      url.searchParams.set("returnPolicy", "PlaceHolder");
      url.searchParams.set("size", "256x256");
      url.searchParams.set("format", "Webp");
      url.searchParams.set("isCircular", "false");

      return fetchJsonWithRetry(url.href, {
        headers: { Accept: "application/json" },
      });
    }),
  );

  return responses.flatMap((response) =>
    Array.isArray(response?.data) ? response.data : [],
  );
}

async function fetchHomeFavorites(userId) {
  const url = new URL(
    `https://games.roblox.com/v2/users/${userId}/favorite/games`,
  );
  url.searchParams.set("accessFilter", "2");
  url.searchParams.set("limit", "50");
  url.searchParams.set("sortOrder", "Desc");

  const payload = await fetchJsonWithRetry(url.href, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });

  if (!Array.isArray(payload?.data)) {
    throw new ApiError(
      "INVALID_FAVORITES_RESPONSE",
      "Roblox devolvió una lista de favoritos inválida.",
    );
  }

  const favorites = payload.data.slice(0, 30);
  const universeIds = favorites
    .map((favorite) => Number(favorite?.id))
    .filter((id) => Number.isSafeInteger(id) && id > 0);

  if (!universeIds.length) {
    return { games: [] };
  }

  const [games, votes, icons] = await Promise.all([
    fetchHomeGames(universeIds),
    fetchHomeGameVotes(universeIds).catch(() => []),
    fetchHomeGameIcons(universeIds).catch(() => []),
  ]);
  const gameByUniverseId = new Map(
    games.map((game) => [Number(game?.id), game]),
  );
  const votesByUniverseId = new Map(
    votes.map((vote) => [Number(vote?.id), vote]),
  );
  const iconByUniverseId = new Map(
    icons.map((icon) => [Number(icon?.targetId), icon?.imageUrl]),
  );

  return {
    games: favorites
      .map((favorite) => {
        const universeId = Number(favorite?.id);
        return normalizeHomeFavoriteGame(
          favorite,
          gameByUniverseId.get(universeId),
          votesByUniverseId.get(universeId),
          iconByUniverseId.get(universeId),
        );
      })
      .filter(Boolean),
  };
}

async function fetchHomeGames(universeIds) {
  const responses = await Promise.all(
    chunkValues(universeIds, 50).map((batch) => {
      const url = new URL("https://games.roblox.com/v1/games");
      url.searchParams.set("universeIds", batch.join(","));
      return fetchJsonWithRetry(url.href, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
    }),
  );

  return responses.flatMap((response) =>
    Array.isArray(response?.data) ? response.data : [],
  );
}

async function fetchHomeGameVotes(universeIds) {
  const responses = await Promise.all(
    chunkValues(universeIds, 50).map((batch) => {
      const url = new URL("https://games.roblox.com/v1/games/votes");
      url.searchParams.set("universeIds", batch.join(","));
      return fetchJsonWithRetry(url.href, {
        headers: { Accept: "application/json" },
      });
    }),
  );

  return responses.flatMap((response) =>
    Array.isArray(response?.data) ? response.data : [],
  );
}

function normalizeHomeFavoriteGame(favorite, game, votes, imageUrl) {
  const universeId = Number(favorite?.id);
  const placeId = Number(game?.rootPlaceId || favorite?.rootPlace?.id);
  const name = normalizeHomeText(game?.name || favorite?.name, 120);
  const playerCount = Number(game?.playing);
  const upVotes = Number(votes?.upVotes);
  const downVotes = Number(votes?.downVotes);
  const totalVotes = upVotes + downVotes;

  if (
    !Number.isSafeInteger(universeId) ||
    universeId <= 0 ||
    !Number.isSafeInteger(placeId) ||
    placeId <= 0 ||
    !name
  ) {
    return null;
  }

  return {
    imageUrl:
      typeof imageUrl === "string" && /^https:\/\//i.test(imageUrl)
        ? imageUrl
        : null,
    name,
    placeId,
    playerCount:
      Number.isSafeInteger(playerCount) && playerCount >= 0 ? playerCount : 0,
    rating:
      Number.isSafeInteger(upVotes) &&
      upVotes >= 0 &&
      Number.isSafeInteger(downVotes) &&
      downVotes >= 0 &&
      totalVotes > 0
        ? Math.round((upVotes / totalVotes) * 100)
        : null,
    universeId,
  };
}

function normalizeHomeFriend(profile, presence, thumbnail, customNameValue) {
  const id = Number(profile?.id);
  const username = normalizeHomeText(profile?.name, 20);
  const displayName = normalizeHomeText(profile?.displayName, 50);
  const customName = normalizeHomeText(customNameValue, 50) || null;

  if (!Number.isSafeInteger(id) || id <= 0 || !username || !displayName) {
    return null;
  }

  const gameId = normalizeHomeJobId(presence?.gameId);
  const placeId = Number(presence?.rootPlaceId || presence?.placeId);
  const universeId = Number(presence?.universeId);
  const { label: activity, status } = normalizeProfilePresence(presence);

  const imageUrl = thumbnail?.imageUrl;

  return {
    activity,
    avatarUrl:
      typeof imageUrl === "string" && /^https:\/\//i.test(imageUrl)
        ? imageUrl
        : null,
    customName,
    displayName,
    gameId: status === "playing" ? gameId : null,
    id,
    placeId:
      status === "playing" && Number.isSafeInteger(placeId) && placeId > 0
        ? placeId
        : null,
    status,
    universeId:
      status === "playing" &&
      Number.isSafeInteger(universeId) &&
      universeId > 0
        ? universeId
        : null,
    username,
  };
}

async function fetchHomeFriendPreview(userId, universeId) {
  const cacheKey = `${userId}:${universeId || 0}`;
  const cached = homeFriendPreviewCache.get(cacheKey);

  if (
    cached &&
    Date.now() - cached.timestamp < HOME_FRIEND_PREVIEW_CACHE_TTL_MS
  ) {
    return cached.value;
  }

  const [profile, friends, followers, following, game] = await Promise.all([
    fetchJsonWithRetry(`https://users.roblox.com/v1/users/${userId}`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    }),
    fetchHomeSocialCount(userId, "friends"),
    fetchHomeSocialCount(userId, "followers"),
    fetchHomeSocialCount(userId, "followings"),
    universeId ? fetchHomeGamePreview(universeId) : null,
  ]);
  const created = typeof profile?.created === "string" ? profile.created : "";

  if (!Number.isFinite(Date.parse(created))) {
    throw new ApiError(
      "INVALID_FRIEND_PREVIEW_RESPONSE",
      "Roblox devolvió un perfil de amigo inválido.",
    );
  }

  const value = {
    created,
    game,
    stats: {
      followers,
      following,
      friends,
    },
  };
  homeFriendPreviewCache.set(cacheKey, {
    timestamp: Date.now(),
    value,
  });
  return value;
}

async function fetchHomeSocialCount(userId, relationship) {
  const payload = await fetchJsonWithRetry(
    `https://friends.roblox.com/v1/users/${userId}/${relationship}/count`,
    {
      credentials: "include",
      headers: { Accept: "application/json" },
    },
  );
  const count = Number(payload?.count);

  if (!Number.isSafeInteger(count) || count < 0) {
    throw new ApiError(
      "INVALID_SOCIAL_COUNT_RESPONSE",
      "Roblox devolvió un conteo social inválido.",
    );
  }

  return count;
}

async function fetchHomeGamePreview(universeId) {
  const gameUrl = new URL("https://games.roblox.com/v1/games");
  gameUrl.searchParams.set("universeIds", String(universeId));
  const thumbnailUrl = new URL("https://thumbnails.roblox.com/v1/games/icons");
  thumbnailUrl.searchParams.set("universeIds", String(universeId));
  thumbnailUrl.searchParams.set("size", "150x150");
  thumbnailUrl.searchParams.set("format", "Webp");
  thumbnailUrl.searchParams.set("isCircular", "false");
  const [gamePayload, thumbnailPayload] = await Promise.all([
    fetchJsonWithRetry(gameUrl.href, {
      credentials: "include",
      headers: { Accept: "application/json" },
    }),
    fetchJsonWithRetry(thumbnailUrl.href, {
      credentials: "include",
      headers: { Accept: "application/json" },
    }).catch(() => null),
  ]);
  const game = gamePayload?.data?.[0];
  const name = normalizeHomeText(game?.name, 120);
  const rootPlaceId = Number(game?.rootPlaceId);
  const imageUrl = thumbnailPayload?.data?.[0]?.imageUrl;

  if (!name || !Number.isSafeInteger(rootPlaceId) || rootPlaceId <= 0) {
    return null;
  }

  return {
    imageUrl:
      typeof imageUrl === "string" && /^https:\/\//i.test(imageUrl)
        ? imageUrl
        : null,
    name,
    placeId: rootPlaceId,
  };
}

function normalizeHomeJobId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9-]{8,100}$/.test(value)
    ? value
    : null;
}

function parseOptionalUniverseId(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const universeId = Number(value);

  if (!Number.isSafeInteger(universeId) || universeId <= 0) {
    throw new ApiError("INVALID_UNIVERSE_ID", "El UniverseId no es válido.");
  }

  return universeId;
}

function parseHomeSearchQuery(value) {
  const query = normalizeHomeText(value, 50);

  if (query.length < 3) {
    throw new ApiError(
      "INVALID_SEARCH_QUERY",
      "Escribe al menos 3 caracteres para buscar jugadores.",
    );
  }

  return query;
}

async function fetchCachedProfileRead(kind, userId, loader, staleRetries = 0) {
  const viewerScoped = kind === "bootstrap" || kind === "friends";
  const mutationSensitive = kind === "bootstrap";
  const account = viewerScoped
    ? await resolveProfileAccountContext()
    : { epoch: 0, key: "public", viewer: null };
  const key = `${account.key}:${userId}:${kind}`;
  const revision = profileReadRevision;
  const cached = readMemoryCache(profileReadCache, key);

  if (cached !== undefined) {
    if (viewerScoped) await validateProfileAccountContext(account);
    if (mutationSensitive && revision !== profileReadRevision) {
      if (staleRetries < 1) {
        return fetchCachedProfileRead(kind, userId, loader, staleRetries + 1);
      }
      throw new ApiError(
        "STALE_PROFILE_READ",
        "El perfil cambió mientras se estaba cargando.",
      );
    }
    return cached;
  }

  let request = profileReadRequests.get(key);

  if (!request) {
    request = {
      promise: (async () => {
        const data = await loader(userId, account);

        if (viewerScoped) await validateProfileAccountContext(account);
        if (mutationSensitive && revision !== profileReadRevision) {
          throw new ApiError(
            "STALE_PROFILE_READ",
            "El perfil cambió mientras se estaba cargando.",
          );
        }
        writeMemoryCache(
          profileReadCache,
          key,
          data,
          PROFILE_READ_CACHE_TTL_MS[kind],
          PROFILE_READ_CACHE_LIMIT,
        );
        return data;
      })(),
    };
    profileReadRequests.set(key, request);
  }

  let result;
  let requestError;
  try {
    result = await request.promise;
  } catch (error) {
    requestError = error;
  } finally {
    if (profileReadRequests.get(key) === request) {
      profileReadRequests.delete(key);
    }
  }

  if (
    requestError instanceof ApiError &&
    requestError.code === "STALE_PROFILE_READ" &&
    staleRetries < 1
  ) {
    return fetchCachedProfileRead(kind, userId, loader, staleRetries + 1);
  }
  if (requestError) throw requestError;
  return result;
}

async function resolveProfileAccountContext() {
  const viewer = await fetchProfileAccountIdentity();
  const key = viewer ? `user:${viewer.id}` : "anonymous";
  updateProfileAccountScope(key);
  return { epoch: profileAccountEpoch, key, viewer };
}

async function validateProfileAccountContext(account) {
  const currentAccount = await resolveProfileAccountContext();

  if (
    currentAccount.key !== account.key ||
    currentAccount.epoch !== account.epoch
  ) {
    throw new ApiError(
      "AUTHENTICATED_USER_CHANGED",
      "La cuenta autenticada de Roblox cambió durante la solicitud.",
    );
  }
}

async function fetchProfileAccountIdentity() {
  try {
    const payload = await fetchJsonWithRetry(
      "https://users.roblox.com/v1/users/authenticated",
      {
        credentials: "include",
        headers: { Accept: "application/json" },
      },
    );
    const id = Number(payload?.id);
    const username = normalizeHomeText(payload?.name, 20);
    const displayName = normalizeHomeText(payload?.displayName, 50);

    if (!Number.isSafeInteger(id) || id <= 0 || !username || !displayName) {
      throw new ApiError(
        "INVALID_USER_RESPONSE",
        "Roblox devolvió datos inválidos para el usuario autenticado.",
      );
    }

    return { displayName, id, username };
  } catch (error) {
    if (error instanceof ApiError && error.code === "AUTH_REQUIRED") {
      return null;
    }

    throw error;
  }
}

function updateProfileAccountScope(key) {
  if (profileAccountKey === key) return;
  profileAccountKey = key;
  profileAccountEpoch += 1;
  profileReadRevision += 1;
  profileMutationCsrfToken = null;
  clearViewerScopedProfileEntries(profileReadCache);
  clearViewerScopedProfileEntries(profileReadRequests);
}

function clearViewerScopedProfileEntries(entries) {
  for (const key of entries.keys()) {
    if (!key.startsWith("public:")) entries.delete(key);
  }
}

function readMemoryCache(cache, key) {
  const entry = cache.get(key);

  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }

  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

function writeMemoryCache(cache, key, value, ttlMs, limit) {
  cache.delete(key);
  cache.set(key, { expiresAt: Date.now() + ttlMs, value });

  while (cache.size > limit) {
    cache.delete(cache.keys().next().value);
  }
}

function invalidateProfileRead(kind, userId, viewerKey = profileAccountKey) {
  if (!viewerKey) return;
  const key = `${viewerKey}:${userId}:${kind}`;
  profileReadRevision += 1;
  profileReadCache.delete(key);
  profileReadRequests.delete(key);
}

async function fetchProfileBootstrap(userId, account) {
  const [viewer, profile, avatarUrl, presences, friends, followers, following] =
    await Promise.all([
      fetchProfileViewer(account.viewer),
      fetchProfileIdentity(userId),
      fetchProfileFullAvatar(userId).catch(() => null),
      fetchFriendPresences([userId]).catch(() => []),
      fetchHomeSocialCount(userId, "friends"),
      fetchHomeSocialCount(userId, "followers"),
      fetchHomeSocialCount(userId, "followings"),
    ]);
  const customNames = viewer
    ? await fetchFriendCustomNames([userId]).catch(() => [])
    : [];
  const customNameValue = customNames.find(
    (entry) => Number(entry?.targetUserId) === userId,
  )?.targetUserTag;
  const presence = normalizeProfilePresence(
    presences.find((entry) => Number(entry?.userId) === userId),
  );
  const isOwnProfile = viewer?.id === userId;
  const [friendshipStatus, isFollowing] =
    viewer && !isOwnProfile
      ? await Promise.all([
          fetchProfileFriendshipStatus(viewer.id, userId).catch(
            () => "Unknown",
          ),
          queueProfileMutation(() => fetchProfileFollowingStatus(userId)).catch(
            () => null,
          ),
        ])
      : [null, null];

  return {
    friendshipStatus,
    isOwnProfile,
    isFollowing,
    profile: {
      ...profile,
      avatarUrl,
      customName: normalizeHomeText(customNameValue, 50) || null,
      followerCount: followers,
      followingCount: following,
      friendCount: friends,
      presenceLabel: presence.label,
      presenceStatus: presence.status,
    },
    viewer,
  };
}

async function fetchProfileFriendshipStatus(viewerUserId, profileUserId) {
  const url = new URL(
    `https://friends.roblox.com/v1/users/${viewerUserId}/friends/statuses`,
  );
  url.searchParams.set("userIds", String(profileUserId));
  const payload = await fetchJsonWithRetry(url.href, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });

  if (!Array.isArray(payload?.data)) {
    throw new ApiError(
      "INVALID_FRIENDSHIP_RESPONSE",
      "Roblox devolvió un estado de amistad inválido.",
    );
  }

  const status = payload.data.find(
    (entry) => Number(entry?.id) === profileUserId,
  )?.status;
  const statusByValue = {
    0: "NotFriends",
    1: "Friends",
    2: "RequestSent",
    3: "RequestReceived",
  };

  if (!Object.hasOwn(statusByValue, status)) {
    throw new ApiError(
      "INVALID_FRIENDSHIP_RESPONSE",
      "Roblox devolvió un estado de amistad desconocido.",
    );
  }

  return statusByValue[status];
}

async function fetchProfileFollowingStatus(profileUserId) {
  let csrfRefreshes = 0;

  while (csrfRefreshes <= 2) {
    const headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };

    if (profileMutationCsrfToken) {
      headers["X-CSRF-TOKEN"] = profileMutationCsrfToken;
    }

    const response = await fetch(
      "https://friends.roblox.com/v1/user/following-exists",
      {
        body: JSON.stringify({ targetUserIds: [profileUserId] }),
        credentials: "include",
        headers,
        method: "POST",
      },
    );

    if (response.status === 403) {
      const nextToken = response.headers.get("x-csrf-token");

      if (nextToken && nextToken !== profileMutationCsrfToken) {
        profileMutationCsrfToken = nextToken;
        csrfRefreshes += 1;
        continue;
      }
    }

    if (!response.ok) {
      throw new ApiError(
        response.status === 401 ? "AUTH_REQUIRED" : "FOLLOW_STATUS_FAILED",
        "No se pudo comprobar el estado de seguimiento.",
        { httpStatus: response.status },
      );
    }

    const payload = await response.json();
    const following = Array.isArray(payload?.followings)
      ? payload.followings.find(
          (entry) => Number(entry?.userId) === profileUserId,
        )
      : null;

    if (typeof following?.isFollowing !== "boolean") {
      throw new ApiError(
        "INVALID_FOLLOW_STATUS_RESPONSE",
        "Roblox devolvió un estado de seguimiento inválido.",
      );
    }

    return following.isFollowing;
  }

  throw new ApiError(
    "FOLLOW_STATUS_FAILED",
    "No se pudo comprobar el estado de seguimiento.",
  );
}

function queueProfileMutation(operation) {
  const scheduled = profileMutationGate.then(operation, operation);
  profileMutationGate = scheduled.catch(() => {});
  return scheduled;
}

async function fetchProfileViewer(viewer) {
  if (!viewer) return null;
  const [avatarUrl, robux] = await Promise.all([
    fetchUserHeadshot(viewer.id),
    fetchUserRobux(),
  ]);
  return { ...viewer, avatarUrl, robux };
}

async function fetchProfileIdentity(userId) {
  const payload = await fetchJsonWithRetry(
    `https://users.roblox.com/v1/users/${userId}`,
    {
      credentials: "include",
      headers: { Accept: "application/json" },
    },
  );
  const id = Number(payload?.id);
  const username = normalizeHomeText(payload?.name, 20);
  const displayName = normalizeHomeText(payload?.displayName, 50);
  const created = normalizeHomeText(payload?.created, 50);

  if (
    id !== userId ||
    !Number.isSafeInteger(id) ||
    !username ||
    !displayName ||
    !Number.isFinite(Date.parse(created))
  ) {
    throw new ApiError(
      "INVALID_PROFILE_RESPONSE",
      "Roblox devolvió una identidad de perfil inválida.",
    );
  }

  return {
    created,
    description: normalizeHomeText(payload?.description, 1000),
    displayName,
    hasVerifiedBadge: payload?.hasVerifiedBadge === true,
    id,
    isBanned: payload?.isBanned === true,
    username,
  };
}

function normalizeProfilePresence(presence) {
  const presenceType = Number(presence?.userPresenceType);
  const location = normalizeHomeText(presence?.lastLocation, 120);
  let label = "Offline";
  let status = "offline";

  if (presenceType === 2) {
    label = location && location !== "Website" ? location : "Playing";
    status = "playing";
  } else if (presenceType === 3) {
    label = "Roblox Studio";
    status = "studio";
  } else if (presenceType === 1) {
    label = "Online";
    status = "online";
  }

  return { label, status };
}

async function fetchProfileFullAvatar(userId) {
  const key = String(userId);
  const cached = readMemoryCache(profileFullAvatarCache, key);

  if (cached !== undefined) return cached;
  const activeRequest = profileFullAvatarRequests.get(key);
  if (activeRequest) return activeRequest;

  const request = fetchProfileFullAvatarUncached(userId).then((avatarUrl) => {
    writeMemoryCache(
      profileFullAvatarCache,
      key,
      avatarUrl,
      PROFILE_RESOURCE_CACHE_TTL_MS,
      PROFILE_RESOURCE_CACHE_LIMIT,
    );
    return avatarUrl;
  });
  profileFullAvatarRequests.set(key, request);

  try {
    return await request;
  } finally {
    if (profileFullAvatarRequests.get(key) === request) {
      profileFullAvatarRequests.delete(key);
    }
  }
}

async function fetchProfileFullAvatarUncached(userId) {
  const url = new URL("https://thumbnails.roblox.com/v1/users/avatar");
  url.searchParams.set("userIds", String(userId));
  url.searchParams.set("size", "420x420");
  url.searchParams.set("format", "Webp");
  url.searchParams.set("isCircular", "false");
  const payload = await fetchJsonWithRetry(url.href, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  const thumbnail = Array.isArray(payload?.data)
    ? payload.data.find((entry) => Number(entry?.targetId) === userId)
    : null;

  return normalizeProfileImageUrl(thumbnail?.imageUrl);
}

async function fetchProfileAvatar(userId) {
  const [payload, avatarUrl] = await Promise.all([
    fetchJsonWithRetry(`https://avatar.roblox.com/v1/users/${userId}/avatar`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    }),
    fetchProfileFullAvatar(userId).catch(() => null),
  ]);

  if (!Array.isArray(payload?.assets)) {
    throw new ApiError(
      "INVALID_AVATAR_RESPONSE",
      "Roblox devolvió un avatar inválido.",
    );
  }

  const seenAssetIds = new Set();
  const rawAssets = [...payload.assets];

  if (Array.isArray(payload.emotes)) {
    payload.emotes.forEach((emote) => {
      rawAssets.push({
        assetType: { name: "EmoteAnimation" },
        id: emote?.assetId,
        name: emote?.assetName,
      });
    });
  }

  const assets = rawAssets
    .map((asset) => {
      const id = Number(asset?.id);
      const name = normalizeHomeText(asset?.name, 120);
      const assetType = normalizeHomeText(asset?.assetType?.name, 50);

      if (
        !Number.isSafeInteger(id) ||
        id <= 0 ||
        !name ||
        !assetType ||
        seenAssetIds.has(id)
      ) {
        return null;
      }

      seenAssetIds.add(id);
      return { assetType, id, name };
    })
    .filter(Boolean);
  const [thumbnails, prices] = assets.length
    ? await Promise.all([
        fetchProfileAssetThumbnails(assets.map((asset) => asset.id)).catch(
          () => [],
        ),
        fetchProfileAssetPrices(assets.map((asset) => asset.id)).catch(() => []),
      ])
    : [[], []];
  const thumbnailByAssetId = new Map(
    thumbnails.map((thumbnail) => [
      Number(thumbnail?.targetId),
      normalizeProfileImageUrl(thumbnail?.imageUrl),
    ]),
  );
  const priceByAssetId = new Map(prices.map((price) => [price.id, price]));

  return {
    assets: assets.map((asset) => {
      const price = priceByAssetId.get(asset.id);

      return {
        ...asset,
        imageUrl: thumbnailByAssetId.get(asset.id) || null,
        isForSale: price?.isForSale ?? null,
        priceInRobux: price?.priceInRobux ?? null,
      };
    }),
    avatarUrl,
  };
}

async function fetchProfileAssetThumbnails(assetIds) {
  const responses = await Promise.all(
    chunkValues(assetIds, 50).map((batch) => {
      const url = new URL("https://thumbnails.roblox.com/v1/assets");
      url.searchParams.set("assetIds", batch.join(","));
      url.searchParams.set("returnPolicy", "PlaceHolder");
      url.searchParams.set("size", "150x150");
      url.searchParams.set("format", "Webp");
      url.searchParams.set("isCircular", "false");
      return fetchJsonWithRetry(url.href, {
        headers: { Accept: "application/json" },
      });
    }),
  );

  return responses.flatMap((response) =>
    Array.isArray(response?.data) ? response.data : [],
  );
}

async function fetchProfileAssetPrices(assetIds) {
  const prices = [];

  for (const batch of chunkValues(assetIds, 8)) {
    const payloads = await Promise.all(
      batch.map((assetId) =>
        fetchJsonWithRetry(
          `https://economy.roblox.com/v2/assets/${assetId}/details`,
          {
            credentials: "include",
            headers: { Accept: "application/json" },
          },
        ).catch(() => null),
      ),
    );

    payloads.forEach((payload, index) => {
      const id = Number(payload?.AssetId || payload?.TargetId);
      const rawPrice = payload?.PriceInRobux;
      const priceInRobux =
        rawPrice === null || rawPrice === undefined ? null : Number(rawPrice);

      if (id !== batch[index] || !Number.isSafeInteger(id) || id <= 0) {
        return;
      }

      prices.push({
        id,
        isForSale:
          typeof payload?.IsForSale === "boolean" ? payload.IsForSale : null,
        priceInRobux:
          Number.isSafeInteger(priceInRobux) && priceInRobux >= 0
            ? priceInRobux
            : null,
      });
    });
  }

  return prices;
}

async function fetchProfileCreations(userId) {
  const url = new URL(`https://games.roblox.com/v2/users/${userId}/games`);
  url.searchParams.set("accessFilter", "Public");
  url.searchParams.set("limit", "50");
  url.searchParams.set("sortOrder", "Desc");
  const payload = await fetchJsonWithRetry(url.href, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });

  if (!Array.isArray(payload?.data)) {
    throw new ApiError(
      "INVALID_CREATIONS_RESPONSE",
      "Roblox devolvió una lista de creaciones inválida.",
    );
  }

  return {
    games: await enrichProfileGames(payload.data.slice(0, 50)),
    truncated: payload.data.length > 50 || hasNextPageCursor(payload),
  };
}

async function fetchProfileFavorites(userId) {
  const url = new URL(
    `https://games.roblox.com/v2/users/${userId}/favorite/games`,
  );
  url.searchParams.set("accessFilter", "2");
  url.searchParams.set("limit", "50");
  url.searchParams.set("sortOrder", "Desc");
  const payload = await fetchJsonWithRetry(url.href, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });

  if (!Array.isArray(payload?.data)) {
    throw new ApiError(
      "INVALID_FAVORITES_RESPONSE",
      "Roblox devolvió una lista de favoritos inválida.",
    );
  }

  return {
    games: await enrichProfileGames(payload.data.slice(0, 50)),
    truncated: payload.data.length > 50 || hasNextPageCursor(payload),
  };
}

async function enrichProfileGames(entries) {
  const seenUniverseIds = new Set();
  const validEntries = entries.filter((entry) => {
    const universeId = Number(entry?.id);

    if (
      !Number.isSafeInteger(universeId) ||
      universeId <= 0 ||
      seenUniverseIds.has(universeId)
    ) {
      return false;
    }

    seenUniverseIds.add(universeId);
    return true;
  });
  const universeIds = validEntries.map((entry) => Number(entry.id));

  if (!universeIds.length) {
    return [];
  }

  const enrichmentByUniverseId = await fetchProfileGameEnrichments(universeIds);

  return validEntries
    .map((entry) => {
      const universeId = Number(entry.id);
      const enrichment = enrichmentByUniverseId.get(universeId) || {};
      return normalizeHomeFavoriteGame(
        entry,
        enrichment.game,
        enrichment.votes,
        enrichment.iconUrl,
      );
    })
    .filter(Boolean)
    .map((game) => ({
      ...game,
      imageUrl: normalizeProfileImageUrl(game.imageUrl),
    }));
}

async function fetchProfileGameEnrichments(universeIds) {
  const claimed = [];
  const valuePromises = universeIds.map((universeId) => {
    const key = String(universeId);
    const cached = readMemoryCache(profileGameEnrichmentCache, key);

    if (cached !== undefined) {
      return Promise.resolve([universeId, cached]);
    }

    const activeRequest = profileGameEnrichmentRequests.get(key);

    if (activeRequest) {
      return activeRequest.promise.then((value) => [universeId, value]);
    }

    const deferred = createDeferred();
    profileGameEnrichmentRequests.set(key, deferred);
    claimed.push({ deferred, key, universeId });
    return deferred.promise.then((value) => [universeId, value]);
  });
  const valuesRequest = Promise.all(valuePromises);

  if (claimed.length) {
    resolveProfileGameEnrichmentClaims(claimed);
  }

  return new Map(await valuesRequest);
}

async function resolveProfileGameEnrichmentClaims(claimed) {
  const universeIds = claimed.map((claim) => claim.universeId);

  try {
    const [games, votes, icons] = await Promise.all([
      fetchHomeGames(universeIds),
      fetchHomeGameVotes(universeIds).catch(() => []),
      fetchHomeGameIcons(universeIds).catch(() => []),
    ]);
    const gameByUniverseId = new Map(
      games.map((game) => [Number(game?.id), game]),
    );
    const votesByUniverseId = new Map(
      votes.map((vote) => [Number(vote?.id), vote]),
    );
    const iconByUniverseId = new Map(
      icons.map((icon) => [Number(icon?.targetId), icon?.imageUrl]),
    );

    claimed.forEach((claim) => {
      const value = {
        game: gameByUniverseId.get(claim.universeId) || null,
        iconUrl: iconByUniverseId.get(claim.universeId) || null,
        votes: votesByUniverseId.get(claim.universeId) || null,
      };

      writeMemoryCache(
        profileGameEnrichmentCache,
        claim.key,
        value,
        PROFILE_GAME_ENRICHMENT_CACHE_TTL_MS,
        PROFILE_GAME_ENRICHMENT_CACHE_LIMIT,
      );
      claim.deferred.resolve(value);
    });
  } catch (error) {
    claimed.forEach((claim) => claim.deferred.reject(error));
  } finally {
    claimed.forEach((claim) => {
      if (profileGameEnrichmentRequests.get(claim.key) === claim.deferred) {
        profileGameEnrichmentRequests.delete(claim.key);
      }
    });
  }
}

function createDeferred() {
  let reject;
  let resolve;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

function hasNextPageCursor(payload) {
  return (
    typeof payload?.nextPageCursor === "string" &&
    payload.nextPageCursor.length > 0
  );
}

async function fetchProfileFriends(userId, account) {
  const payload = await fetchJsonWithRetry(
    `https://friends.roblox.com/v1/users/${userId}/friends`,
    {
      credentials: "include",
      headers: { Accept: "application/json" },
    },
  );

  if (!Array.isArray(payload?.data)) {
    throw new ApiError(
      "INVALID_FRIENDS_RESPONSE",
      "Roblox devolvió una lista de amigos inválida.",
    );
  }

  const sourceByUserId = new Map();

  payload.data.slice(0, 200).forEach((friend) => {
    const id = Number(friend?.id);

    if (Number.isSafeInteger(id) && id > 0 && !sourceByUserId.has(id)) {
      sourceByUserId.set(id, friend);
    }
  });

  const userIds = [...sourceByUserId.keys()];

  if (!userIds.length) {
    return { count: 0, friends: [] };
  }

  const [profiles, presences, thumbnails, customNames] = await Promise.all([
    fetchFriendProfiles(userIds),
    fetchFriendPresences(userIds).catch(() => []),
    fetchFriendThumbnails(userIds).catch(() => []),
    account.viewer ? fetchFriendCustomNames(userIds).catch(() => []) : [],
  ]);
  const profileByUserId = new Map(
    profiles.map((profile) => [Number(profile?.id), profile]),
  );
  const presenceByUserId = new Map(
    presences.map((presence) => [Number(presence?.userId), presence]),
  );
  const thumbnailByUserId = new Map(
    thumbnails.map((thumbnail) => [Number(thumbnail?.targetId), thumbnail]),
  );
  const customNameByUserId = new Map(
    customNames.map((entry) => [
      Number(entry?.targetUserId),
      entry?.targetUserTag,
    ]),
  );
  const friends = userIds
    .map((friendId) =>
      normalizeHomeFriend(
        profileByUserId.get(friendId) || sourceByUserId.get(friendId),
        presenceByUserId.get(friendId),
        thumbnailByUserId.get(friendId),
        customNameByUserId.get(friendId),
      ),
    )
    .filter(Boolean)
    .map((friend) => ({
      ...friend,
      avatarUrl: normalizeProfileImageUrl(friend.avatarUrl),
    }))
    .sort(compareHomeFriends);

  return { count: friends.length, friends };
}

async function fetchProfileCommunities(userId) {
  const url = new URL(
    `https://groups.roblox.com/v1/users/${userId}/groups/roles`,
  );
  url.searchParams.set("includeLocked", "true");
  const [payload, primaryMembership] = await Promise.all([
    fetchJsonWithRetry(url.href, {
      credentials: "include",
      headers: { Accept: "application/json" },
    }),
    fetchJsonWithRetry(
      `https://groups.roblox.com/v1/users/${userId}/groups/primary/role`,
      {
        credentials: "include",
        headers: { Accept: "application/json" },
      },
    ).catch(() => null),
  ]);

  if (!Array.isArray(payload?.data)) {
    throw new ApiError(
      "INVALID_COMMUNITIES_RESPONSE",
      "Roblox devolvió una lista de comunidades inválida.",
    );
  }

  const seenGroupIds = new Set();
  const primaryGroupId = Number(primaryMembership?.group?.id);
  const communities = payload.data
    .map((membership) => {
      const group = membership?.group;
      const id = Number(group?.id);
      const name = normalizeHomeText(group?.name, 100);
      const memberCount = Number(group?.memberCount);
      const role = normalizeHomeText(membership?.role?.name, 100);

      if (
        !Number.isSafeInteger(id) ||
        id <= 0 ||
        !name ||
        !role ||
        !Number.isSafeInteger(memberCount) ||
        memberCount < 0 ||
        seenGroupIds.has(id)
      ) {
        return null;
      }

      seenGroupIds.add(id);
      return {
        hasVerifiedBadge: group?.hasVerifiedBadge === true,
        id,
        isPrimaryGroup:
          membership?.isPrimaryGroup === true || primaryGroupId === id,
        memberCount,
        name,
        role,
        roleName: role,
      };
    })
    .filter(Boolean);
  const thumbnails = communities.length
    ? await fetchProfileGroupIcons(
        communities.map((community) => community.id),
      ).catch(() => [])
    : [];
  const thumbnailByGroupId = new Map(
    thumbnails.map((thumbnail) => [
      Number(thumbnail?.targetId),
      normalizeProfileImageUrl(thumbnail?.imageUrl),
    ]),
  );

  return {
    communities: communities.map((community) => ({
      ...community,
      imageUrl: thumbnailByGroupId.get(community.id) || null,
    })),
  };
}

async function fetchProfileGroupIcons(groupIds) {
  const responses = await Promise.all(
    chunkValues(groupIds, 50).map((batch) => {
      const url = new URL("https://thumbnails.roblox.com/v1/groups/icons");
      url.searchParams.set("groupIds", batch.join(","));
      url.searchParams.set("size", "150x150");
      url.searchParams.set("format", "Webp");
      url.searchParams.set("isCircular", "false");
      return fetchJsonWithRetry(url.href, {
        headers: { Accept: "application/json" },
      });
    }),
  );

  return responses.flatMap((response) =>
    Array.isArray(response?.data) ? response.data : [],
  );
}

async function fetchProfileBadges(userId) {
  const badges = [];
  const badgeIds = new Set();
  const requestedCursors = new Set();
  let cursor = null;
  let truncated = false;

  for (let page = 0; page < 1; page += 1) {
    const cursorKey = cursor || "__first_page__";

    if (requestedCursors.has(cursorKey)) {
      truncated = true;
      break;
    }

    requestedCursors.add(cursorKey);
    const url = new URL(
      `https://badges.roblox.com/v1/users/${userId}/badges`,
    );
    url.searchParams.set("limit", "25");
    url.searchParams.set("sortOrder", "Desc");

    if (cursor) {
      url.searchParams.set("cursor", cursor);
    }

    const payload = await fetchJsonWithRetry(url.href, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });

    if (!Array.isArray(payload?.data)) {
      throw new ApiError(
        "INVALID_BADGES_RESPONSE",
        "Roblox devolvió una lista de insignias inválida.",
      );
    }

    for (const badge of payload.data) {
      const normalized = normalizeProfileBadge(badge);

      if (!normalized || badgeIds.has(normalized.id)) {
        continue;
      }

      if (badges.length >= PROFILE_BADGE_LIMIT) {
        truncated = true;
      } else {
        badgeIds.add(normalized.id);
        badges.push(normalized);
      }
    }

    const nextCursor = payload?.nextPageCursor;

    if (nextCursor === null || nextCursor === undefined || nextCursor === "") {
      cursor = null;
      break;
    }

    if (typeof nextCursor !== "string" || nextCursor.length > 2000) {
      truncated = true;
      break;
    }

    cursor = nextCursor;

    if (page === 0 || requestedCursors.has(cursor)) {
      truncated = true;
      break;
    }
  }

  const thumbnails = badges.length
    ? await fetchProfileBadgeIcons(badges.map((badge) => badge.id))
    : [];
  const thumbnailByBadgeId = new Map(
    thumbnails.map((thumbnail) => [
      Number(thumbnail?.targetId),
      normalizeProfileImageUrl(thumbnail?.imageUrl),
    ]),
  );

  return {
    badges: badges.map((badge) => ({
      ...badge,
      imageUrl: thumbnailByBadgeId.get(badge.id) || null,
    })),
    truncated,
  };
}

function normalizeProfileBadge(badge) {
  const id = Number(badge?.id);
  const name = normalizeHomeText(badge?.name || badge?.displayName, 100);

  if (!Number.isSafeInteger(id) || id <= 0 || !name) {
    return null;
  }

  const created = normalizeHomeText(badge?.created, 50);
  const updated = normalizeHomeText(badge?.updated, 50);

  return {
    created: Number.isFinite(Date.parse(created)) ? created : null,
    description: normalizeHomeText(
      badge?.description || badge?.displayDescription,
      1000,
    ),
    id,
    name,
    updated: Number.isFinite(Date.parse(updated)) ? updated : null,
  };
}

async function fetchProfileBadgeIcons(badgeIds) {
  const responses = await Promise.all(
    chunkValues(badgeIds, 50).map(async (batch) => {
      const url = new URL("https://thumbnails.roblox.com/v1/badges/icons");
      url.searchParams.set("badgeIds", batch.join(","));
      url.searchParams.set("size", "150x150");
      url.searchParams.set("format", "Webp");
      url.searchParams.set("isCircular", "false");

      try {
        return await fetchJsonWithRetry(url.href, {
          headers: { Accept: "application/json" },
        });
      } catch {
        return null;
      }
    }),
  );

  return responses.flatMap((response) =>
    Array.isArray(response?.data) ? response.data : [],
  );
}

function normalizeProfileImageUrl(value) {
  if (typeof value !== "string" || value.length > 2000) {
    return null;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

async function mutateProfileRelationship(userId, action, sender) {
  const pageUserId = getProfileUserIdFromSender(sender);

  if (pageUserId !== userId) {
    throw new ApiError(
      "PROFILE_PAGE_MISMATCH",
      "La acción no coincide con el perfil de Roblox abierto.",
    );
  }

  const authenticatedUserId = await fetchAuthenticatedUserId();
  const viewerKey = `user:${authenticatedUserId}`;
  updateProfileAccountScope(viewerKey);

  if (authenticatedUserId === userId) {
    throw new ApiError(
      "SELF_RELATIONSHIP_NOT_ALLOWED",
      "No puedes realizar esta acción sobre tu propio perfil.",
    );
  }

  let csrfRefreshes = 0;
  let transientAttempts = 0;

  while (transientAttempts <= SERVER_BROWSER_CONFIG.maxRetries) {
    const currentUserId = await fetchAuthenticatedUserId();

    if (currentUserId !== authenticatedUserId) {
      throw new ApiError(
        "AUTHENTICATED_USER_CHANGED",
        "La cuenta autenticada de Roblox cambió durante la solicitud.",
      );
    }

    const headers = { Accept: "application/json" };

    if (profileMutationCsrfToken) {
      headers["X-CSRF-TOKEN"] = profileMutationCsrfToken;
    }

    let response;

    try {
      response = await fetch(
        `https://friends.roblox.com/v1/users/${userId}/${action}`,
        { credentials: "include", headers, method: "POST" },
      );
    } catch (error) {
      if (transientAttempts === SERVER_BROWSER_CONFIG.maxRetries) {
        throw new ApiError(
          "NETWORK_ERROR",
          "No se pudo conectar con la API social de Roblox.",
          { cause: error?.message ?? "" },
        );
      }

      await delay(getBackoffDelay(transientAttempts));
      transientAttempts += 1;
      continue;
    }

    if (response.status === 403) {
      const nextToken = response.headers.get("x-csrf-token");

      if (
        nextToken &&
        nextToken !== profileMutationCsrfToken &&
        csrfRefreshes < 2
      ) {
        profileMutationCsrfToken = nextToken;
        csrfRefreshes += 1;
        continue;
      }
    }

    if (response.ok) {
      const text = await response.text();

      if (text) {
        let payload;

        try {
          payload = JSON.parse(text);
        } catch {
          throw new ApiError(
            "INVALID_JSON",
            "Roblox devolvió una respuesta social inválida.",
          );
        }

        if (payload?.success === false) {
          throw new ApiError(
            payload?.isCaptchaRequired === true
              ? "CAPTCHA_REQUIRED"
              : "PROFILE_ACTION_FAILED",
            payload?.isCaptchaRequired === true
              ? "Roblox requiere completar una verificación antes de esta acción."
              : "Roblox no pudo completar esta acción social.",
          );
        }
      }

      invalidateProfileRead("bootstrap", userId, viewerKey);
      return { success: true };
    }

    if (
      (response.status === 429 || response.status >= 500) &&
      transientAttempts < SERVER_BROWSER_CONFIG.maxRetries
    ) {
      await delay(getRetryDelay(response, transientAttempts));
      transientAttempts += 1;
      continue;
    }

    if (response.status === 401) {
      throw new ApiError(
        "AUTH_REQUIRED",
        "Inicia sesión nuevamente en Roblox para realizar esta acción.",
        { httpStatus: response.status },
      );
    }

    throw new ApiError(
      response.status === 403
        ? "PROFILE_ACTION_FORBIDDEN"
        : response.status === 429
          ? "RATE_LIMITED"
          : response.status >= 500
            ? "ROBLOX_UNAVAILABLE"
            : "PROFILE_ACTION_FAILED",
      response.status === 403
        ? "Roblox rechazó la autorización para esta acción."
        : `No se pudo completar la acción (HTTP ${response.status}).`,
      { httpStatus: response.status },
    );
  }
}

function getProfileUserIdFromSender(sender) {
  let url;

  try {
    url = new URL(sender?.url || sender?.tab?.url || "");
  } catch {
    url = null;
  }

  const match =
    url?.protocol === "https:" &&
    url.hostname.toLowerCase() === "www.roblox.com"
      ? url.pathname.match(
          /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?users\/(\d+)\/profile\/?$/i,
        )
      : null;
  const userId = Number(match?.[1]);

  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new ApiError(
      "INVALID_PROFILE_PAGE",
      "La acción debe iniciarse desde un perfil válido de Roblox.",
    );
  }

  return userId;
}

function compareHomeFriends(left, right) {
  const rank = { playing: 0, studio: 1, online: 2, offline: 3 };
  const presenceDifference = rank[left.status] - rank[right.status];

  return (
    presenceDifference ||
    (left.customName || left.displayName).localeCompare(
      right.customName || right.displayName,
      undefined,
      { sensitivity: "base" },
    )
  );
}

function chunkValues(values, size) {
  const chunks = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function parseUserId(value) {
  const userId = Number(value);

  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new ApiError("INVALID_USER_ID", "El UserId no es válido.");
  }

  return userId;
}

function getRobloxTabId(sender) {
  const tabId = sender?.tab?.id;
  const tabUrl = sender?.tab?.url;

  if (
    !Number.isInteger(tabId) ||
    typeof tabUrl !== "string" ||
    !/^https:\/\/www\.roblox\.com\//i.test(tabUrl)
  ) {
    throw new ApiError(
      "ROBLOX_TAB_REQUIRED",
      "La comprobación regional debe iniciarse desde una página de Roblox.",
    );
  }

  return tabId;
}

function parsePlaceId(value) {
  const placeId = Number(value);

  if (!Number.isSafeInteger(placeId) || placeId <= 0) {
    throw new ApiError("INVALID_PLACE_ID", "El PlaceId no es válido.");
  }

  return placeId;
}

function parseJobId(value) {
  if (
    typeof value !== "string" ||
    value.length < 8 ||
    value.length > 100 ||
    !/^[a-zA-Z0-9-]+$/.test(value)
  ) {
    throw new ApiError("INVALID_JOB_ID", "El JobId no es válido.");
  }

  return value;
}

function parsePublicServerSortOrder(value) {
  if (value !== "Asc" && value !== "Desc") {
    throw new ApiError(
      "INVALID_SERVER_SORT_ORDER",
      "El orden de los servidores no es válido.",
    );
  }

  return value;
}

async function fetchPublicServers(placeId, sortOrder) {
  const servers = [];
  const requestedCursors = new Set();
  const seenJobIds = new Set();
  let cursor = null;
  let pagesFetched = 0;

  do {
    const cursorKey = cursor || "__first_page__";

    if (requestedCursors.has(cursorKey)) {
      throw new ApiError(
        "PAGINATION_LOOP",
        "Roblox repitió un cursor de paginación y se detuvo el análisis para evitar un bucle.",
      );
    }

    requestedCursors.add(cursorKey);

    const url = new URL(
      `https://games.roblox.com/v1/games/${placeId}/servers/Public`,
    );
    url.searchParams.set("sortOrder", sortOrder);
    url.searchParams.set("excludeFullGames", "true");
    url.searchParams.set(
      "limit",
      String(SERVER_BROWSER_CONFIG.serversPerPage),
    );

    if (cursor) {
      url.searchParams.set("cursor", cursor);
    }

    const payload = await fetchJsonWithRetry(url.href, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });

    if (!payload || !Array.isArray(payload.data)) {
      throw new ApiError(
        "INVALID_SERVER_RESPONSE",
        "Roblox devolvió una lista de servidores inválida.",
      );
    }

    payload.data.forEach((server) => {
      const normalized = normalizePublicServer(server);

      if (normalized && !seenJobIds.has(normalized.jobId)) {
        seenJobIds.add(normalized.jobId);
        servers.push(normalized);
      }
    });

    pagesFetched += 1;
    cursor =
      typeof payload.nextPageCursor === "string" &&
      payload.nextPageCursor.length > 0
        ? payload.nextPageCursor
        : null;
  } while (cursor);

  return {
    pagesFetched,
    servers,
    truncated: false,
  };
}

function normalizePublicServer(server) {
  if (!server || typeof server !== "object") {
    return null;
  }

  let jobId;

  try {
    jobId = parseJobId(server.id);
  } catch {
    return null;
  }

  return {
    jobId,
    players: toNonNegativeInteger(server.playing),
    maxPlayers: toNonNegativeInteger(server.maxPlayers),
    fps: toFiniteNumber(server.fps),
    ping: toFiniteNumber(server.ping),
  };
}

async function getServerRegion(placeId, jobId, tabId) {
  const cached = await readCachedRegion(placeId, jobId);

  if (cached) {
    const location = await getDataCenterLocation(
      cached.dataCenterId,
      cached.endpointAddress,
    );
    return { ...cached, cached: true, location };
  }

  const payload = await fetchJoinPayloadWithRetry(placeId, jobId, tabId);
  const joinScript = payload?.joinScript;

  if (!joinScript || typeof joinScript !== "object") {
    const message =
      typeof payload?.message === "string" ? payload.message : "";
    const isUnavailable =
      payload?.status === 12 ||
      payload?.status === 22 ||
      /unable to join|full|shut down|no longer available/i.test(message);

    throw new ApiError(
      isUnavailable ? "SERVER_UNAVAILABLE" : "INVALID_JOIN_RESPONSE",
      isUnavailable
        ? "El servidor ya no está disponible."
        : "Roblox no devolvió un joinScript válido.",
      {
        robloxMessage: message,
        robloxStatus: payload?.status ?? null,
      },
    );
  }

  const region = normalizeRegion(joinScript.GameJoinRegion);
  const dataCenterId = toNullableInteger(joinScript.DataCenterId);
  const endpointAddress = normalizeIpAddress(joinScript.UdmuxAddress);

  if (!region && dataCenterId === null) {
    throw new ApiError(
      "MISSING_REGION",
      "Roblox no informó la región ni el datacenter de este servidor.",
    );
  }

  const cacheEntry = {
    cacheVersion: CACHE_VERSION,
    dataCenterId,
    endpointAddress,
    jobId,
    placeId,
    region,
    timestamp: Date.now(),
  };

  await writeLocalCache({
    [getCacheKey(jobId)]: cacheEntry,
  });

  const location = await getDataCenterLocation(
    dataCenterId,
    endpointAddress,
  );

  return { ...cacheEntry, cached: false, location };
}

async function fetchJoinPayloadWithRetry(
  placeId,
  jobId,
  tabId,
  signal = null,
  operationId = null,
) {
  let lastPayload = null;

  for (
    let attempt = 0;
    attempt <= SERVER_BROWSER_CONFIG.maxRetries;
    attempt += 1
  ) {
    throwIfAnalysisAborted(signal);
    await waitForRegionCheckSlot(signal);
    throwIfAnalysisAborted(signal);

    const response = await executeJoinRequestInPage(
      tabId,
      placeId,
      jobId,
      operationId,
      signal,
    );

    if (response.aborted) {
      throw createAnalysisCancellationError();
    }

    if (response.networkError) {
      if (attempt === SERVER_BROWSER_CONFIG.maxRetries) {
        throw new ApiError(
          "NETWORK_ERROR",
          "No se pudo conectar con la API de Roblox desde la página.",
          { cause: response.networkError },
        );
      }

      await abortableDelay(getBackoffDelay(attempt), signal);
      continue;
    }

    if (response.httpStatus === 429) {
      registerRegionRateLimit(response.retryAfter);
    }

    if (response.httpStatus === 429 || response.httpStatus >= 500) {
      if (attempt === SERVER_BROWSER_CONFIG.maxRetries) {
        throw new ApiError(
          response.httpStatus === 429 ? "RATE_LIMITED" : "ROBLOX_UNAVAILABLE",
          response.httpStatus === 429
            ? "Roblox limitó temporalmente las solicitudes."
            : "La API de Roblox no está disponible temporalmente.",
          { httpStatus: response.httpStatus },
        );
      }

      await abortableDelay(
        getRetryDelayFromHeader(response.retryAfter, attempt),
        signal,
      );
      continue;
    }

    if (!response.ok) {
      throw new ApiError(
        response.httpStatus === 401 || response.httpStatus === 403
          ? "AUTH_REQUIRED"
          : "ROBLOX_REQUEST_FAILED",
        response.httpStatus === 401 || response.httpStatus === 403
          ? "Roblox requiere una sesión válida para consultar esta información."
          : `La API de Roblox respondió con HTTP ${response.httpStatus}.`,
        { httpStatus: response.httpStatus },
      );
    }

    if (response.invalidJson) {
      throw new ApiError(
        "INVALID_JSON",
        "Roblox devolvió una respuesta que no es JSON válido.",
      );
    }

    const payload = response.payload;

    lastPayload = payload;

    if (payload?.joinScript && typeof payload.joinScript === "object") {
      return payload;
    }

    const payloadRateLimited = looksRateLimited(payload);

    if (
      !payloadRateLimited ||
      attempt === SERVER_BROWSER_CONFIG.maxRetries
    ) {
      return payload;
    }

    registerRegionRateLimit(null);
    await abortableDelay(getBackoffDelay(attempt), signal);
  }

  return lastPayload;
}

async function executeJoinRequestInPage(
  tabId,
  placeId,
  jobId,
  operationId = null,
  signal = null,
) {
  throwIfAnalysisAborted(signal);

  try {
    const results = await chrome.scripting.executeScript({
      args: [placeId, jobId, operationId],
      func: async (requestPlaceId, requestJobId, requestOperationId) => {
        const controller = new AbortController();
        let controllers = null;

        if (requestOperationId) {
          const registry =
            globalThis.__robloxExtensionServerAnalysisControllers ||
            new Map();
          globalThis.__robloxExtensionServerAnalysisControllers = registry;
          controllers = registry.get(requestOperationId) || new Set();
          controllers.add(controller);
          registry.set(requestOperationId, controllers);
        }

        try {
          const response = await fetch(
            "https://gamejoin.roblox.com/v1/join-game-instance",
            {
              body: JSON.stringify({
                placeId: requestPlaceId,
                gameId: requestJobId,
              }),
              credentials: "include",
              headers: {
                Accept: "*/*",
                "Content-Type": "application/json",
              },
              method: "POST",
              mode: "cors",
              referrer: "https://www.roblox.com/",
              signal: controller.signal,
            },
          );
          const retryAfter = response.headers.get("Retry-After");
          const text = await response.text();
          let payload;

          try {
            const parsed = JSON.parse(text);
            const rawJoinScript =
              parsed?.joinScript && typeof parsed.joinScript === "object"
                ? parsed.joinScript
                : null;
            let gameJoinRegion = rawJoinScript?.GameJoinRegion ?? null;
            const udmuxAddress = Array.isArray(rawJoinScript?.UdmuxEndpoints)
              ? rawJoinScript.UdmuxEndpoints.find(
                  (endpoint) =>
                    endpoint && typeof endpoint.Address === "string",
                )?.Address ?? null
              : null;

            if (
              !gameJoinRegion &&
              typeof rawJoinScript?.SessionId === "string"
            ) {
              try {
                const sessionMetadata = JSON.parse(rawJoinScript.SessionId);
                gameJoinRegion = sessionMetadata?.GameJoinRegion ?? null;
              } catch {
                // SessionId is opaque unless Roblox returns its JSON form.
              }
            }

            const joinScript = rawJoinScript
              ? {
                  DataCenterId: rawJoinScript.DataCenterId ?? null,
                  GameJoinRegion: gameJoinRegion,
                  UdmuxAddress: udmuxAddress,
                }
              : null;

            payload = {
              errors: Array.isArray(parsed?.errors) ? parsed.errors : null,
              jobId: parsed?.jobId ?? null,
              joinScript,
              message:
                typeof parsed?.message === "string" ? parsed.message : "",
              status: parsed?.status ?? null,
            };
          } catch {
            return {
              httpStatus: response.status,
              invalidJson: true,
              ok: response.ok,
              retryAfter,
            };
          }

          return {
            httpStatus: response.status,
            invalidJson: false,
            ok: response.ok,
            payload,
            retryAfter,
          };
        } catch (error) {
          return {
            aborted: controller.signal.aborted,
            networkError:
              error instanceof Error ? error.message : "Unknown fetch error",
          };
        } finally {
          if (requestOperationId && controllers) {
            controllers.delete(controller);

            if (!controllers.size) {
              globalThis.__robloxExtensionServerAnalysisControllers?.delete(
                requestOperationId,
              );
            }
          }
        }
      },
      target: { tabId },
      world: "MAIN",
    });

    throwIfAnalysisAborted(signal);

    const result = results?.[0]?.result;

    if (!result || typeof result !== "object") {
      throw new ApiError(
        "INVALID_PAGE_RESPONSE",
        "La página de Roblox no devolvió el resultado de la comprobación.",
      );
    }

    return result;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(
      "PAGE_REQUEST_FAILED",
      "No se pudo ejecutar la comprobación desde la página de Roblox.",
      { cause: error?.message ?? "" },
    );
  }
}

async function getDataCenterLocation(dataCenterId, address) {
  if (dataCenterId === null) {
    return address ? getIpLocation(address) : null;
  }

  const activeRequest = dataCenterLocationRequests.get(dataCenterId);

  if (activeRequest) {
    return activeRequest;
  }

  const request = (async () => {
    const cached = await readCachedDataCenterLocation(dataCenterId);

    if (cached.hit) {
      return cached.location;
    }

    if (!address) {
      return null;
    }

    const location = await getIpLocation(address);
    await writeCachedDataCenterLocation(
      dataCenterId,
      location,
      location
        ? SERVER_BROWSER_CONFIG.geolocationCacheTtlMs
        : SERVER_BROWSER_CONFIG.geolocationErrorTtlMs,
    );
    return location;
  })();

  dataCenterLocationRequests.set(dataCenterId, request);

  try {
    return await request;
  } finally {
    dataCenterLocationRequests.delete(dataCenterId);
  }
}

async function readCachedDataCenterLocation(dataCenterId, signal = null) {
  const key = getDataCenterLocationCacheKey(dataCenterId);
  const stored = await chrome.storage.local.get(key);
  const entry = stored[key];

  if (
    !entry ||
    entry.cacheVersion !== DATA_CENTER_LOCATION_CACHE_VERSION ||
    entry.dataCenterId !== dataCenterId ||
    !Number.isFinite(entry.expiresAt) ||
    Date.now() >= entry.expiresAt
  ) {
    if (entry) {
      throwIfAnalysisAborted(signal);
      await chrome.storage.local.remove(key);
    }

    return { hit: false, location: null };
  }

  return {
    hit: true,
    location: entry.location
      ? normalizeIpLocation(entry.location, "", false)
      : null,
  };
}

async function writeCachedDataCenterLocation(
  dataCenterId,
  location,
  ttlMs,
) {
  await writeLocalCache({
    [getDataCenterLocationCacheKey(dataCenterId)]: {
      cacheVersion: DATA_CENTER_LOCATION_CACHE_VERSION,
      dataCenterId,
      expiresAt: Date.now() + ttlMs,
      location,
    },
  });
}

async function getIpLocation(address) {
  const activeRequest = geolocationRequests.get(address);

  if (activeRequest) {
    return activeRequest;
  }

  const request = (async () => {
    const cached = await readCachedGeolocation(address);

    if (cached.hit) {
      return cached.location;
    }

    if (Date.now() < geolocationBlockedUntil) {
      return null;
    }

    return fetchIpLocation(address);
  })();

  geolocationRequests.set(address, request);

  try {
    return await request;
  } finally {
    geolocationRequests.delete(address);
  }
}

async function fetchIpLocation(address) {
  const url = new URL(`https://ipwho.is/${encodeURIComponent(address)}`);
  url.searchParams.set(
    "fields",
    [
      "success",
      "message",
      "ip",
      "continent",
      "country",
      "country_code",
      "region",
      "city",
      "latitude",
      "longitude",
    ].join(","),
  );
  url.searchParams.set("lang", "es");

  for (
    let attempt = 0;
    attempt <= SERVER_BROWSER_CONFIG.geolocationMaxRetries;
    attempt += 1
  ) {
    if (Date.now() < geolocationBlockedUntil) {
      return null;
    }

    await waitForGeolocationSlot();

    if (Date.now() < geolocationBlockedUntil) {
      return null;
    }

    let response;

    try {
      response = await fetch(url.href, {
        credentials: "omit",
        headers: { Accept: "application/json" },
        referrerPolicy: "no-referrer",
      });
    } catch {
      if (attempt < SERVER_BROWSER_CONFIG.geolocationMaxRetries) {
        await delay(getBackoffDelay(attempt));
        continue;
      }

      await writeCachedGeolocation(
        address,
        null,
        SERVER_BROWSER_CONFIG.geolocationErrorTtlMs,
      );
      return null;
    }

    if (response.status === 429) {
      geolocationBlockedUntil =
        Date.now() +
        getRetryAfterDurationMs(
          response.headers.get("Retry-After"),
          24 * 60 * 60 * 1000,
        );
      await writeCachedGeolocation(
        address,
        null,
        SERVER_BROWSER_CONFIG.geolocationErrorTtlMs,
      );
      return null;
    }

    if (response.status >= 500) {
      if (attempt < SERVER_BROWSER_CONFIG.geolocationMaxRetries) {
        await delay(getBackoffDelay(attempt));
        continue;
      }

      await writeCachedGeolocation(
        address,
        null,
        SERVER_BROWSER_CONFIG.geolocationErrorTtlMs,
      );
      return null;
    }

    if (!response.ok) {
      await writeCachedGeolocation(
        address,
        null,
        SERVER_BROWSER_CONFIG.geolocationErrorTtlMs,
      );
      return null;
    }

    let payload;

    try {
      payload = await response.json();
    } catch {
      await writeCachedGeolocation(
        address,
        null,
        SERVER_BROWSER_CONFIG.geolocationErrorTtlMs,
      );
      return null;
    }

    const location = normalizeIpLocation(payload, address);

    await writeCachedGeolocation(
      address,
      location,
      location
        ? SERVER_BROWSER_CONFIG.geolocationCacheTtlMs
        : SERVER_BROWSER_CONFIG.geolocationErrorTtlMs,
    );
    return location;
  }

  return null;
}

async function readCachedGeolocation(address, signal = null) {
  const key = getGeolocationCacheKey(address);
  const stored = await chrome.storage.local.get(key);
  const entry = stored[key];

  if (
    !entry ||
    entry.cacheVersion !== GEOLOCATION_CACHE_VERSION ||
    entry.address !== address ||
    !Number.isFinite(entry.expiresAt) ||
    Date.now() >= entry.expiresAt
  ) {
    if (entry) {
      throwIfAnalysisAborted(signal);
      await chrome.storage.local.remove(key);
    }

    return { hit: false, location: null };
  }

  return {
    hit: true,
    location: entry.location
      ? normalizeIpLocation(entry.location, address, false)
      : null,
  };
}

async function writeCachedGeolocation(address, location, ttlMs) {
  await writeLocalCache({
    [getGeolocationCacheKey(address)]: {
      address,
      cacheVersion: GEOLOCATION_CACHE_VERSION,
      expiresAt: Date.now() + ttlMs,
      location,
    },
  });
}

function normalizeIpLocation(payload, requestedAddress, requireSuccess = true) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  if (requireSuccess && payload.success !== true) {
    return null;
  }

  const responseAddress = normalizeIpAddress(payload.ip);

  if (responseAddress && responseAddress !== requestedAddress) {
    return null;
  }

  const location = {
    city: normalizeGeoText(payload.city),
    continent: normalizeGeoText(payload.continent),
    country: normalizeGeoText(payload.country),
    countryCode: normalizeCountryCode(payload.country_code),
    latitude: toNullableCoordinate(payload.latitude, -90, 90),
    longitude: toNullableCoordinate(payload.longitude, -180, 180),
    region: normalizeGeoText(payload.region),
  };

  return location.city || location.region || location.country
    ? location
    : null;
}

function waitForGeolocationSlot(signal = null) {
  const interval =
    1000 / SERVER_BROWSER_CONFIG.geolocationRequestsPerSecond;

  const scheduled = geolocationGate.then(async () => {
    const waitTime = Math.max(0, nextGeolocationCheckAt - Date.now());

    if (waitTime > 0) {
      await abortableDelay(waitTime, signal);
    }

    nextGeolocationCheckAt = Date.now() + interval;
  });

  geolocationGate = scheduled.catch(() => {});
  return scheduled;
}

function looksRateLimited(payload) {
  const text = JSON.stringify(payload ?? "");
  return /rate.?limit|too many requests|try again later/i.test(text);
}

async function fetchJsonWithRetry(url, options, beforeAttempt = null) {
  let lastError;
  const signal = options?.signal || null;

  for (
    let attempt = 0;
    attempt <= SERVER_BROWSER_CONFIG.maxRetries;
    attempt += 1
  ) {
    try {
      throwIfAnalysisAborted(signal);

      if (beforeAttempt) {
        await beforeAttempt();
      }

      const response = await fetch(url, options);

      if (response.status === 429 || response.status >= 500) {
        if (attempt === SERVER_BROWSER_CONFIG.maxRetries) {
          throw new ApiError(
            response.status === 429 ? "RATE_LIMITED" : "ROBLOX_UNAVAILABLE",
            response.status === 429
              ? "Roblox limitó temporalmente las solicitudes."
              : "La API de Roblox no está disponible temporalmente.",
            { httpStatus: response.status },
          );
        }

        await abortableDelay(getRetryDelay(response, attempt), signal);
        continue;
      }

      if (!response.ok) {
        throw new ApiError(
          response.status === 401 || response.status === 403
            ? "AUTH_REQUIRED"
            : "ROBLOX_REQUEST_FAILED",
          response.status === 401 || response.status === 403
            ? "Roblox requiere una sesión válida para consultar esta información."
            : `La API de Roblox respondió con HTTP ${response.status}.`,
          { httpStatus: response.status },
        );
      }

      const text = await response.text();

      try {
        return JSON.parse(text);
      } catch {
        throw new ApiError(
          "INVALID_JSON",
          "Roblox devolvió una respuesta que no es JSON válido.",
        );
      }
    } catch (error) {
      if (isAnalysisCancellation(error, signal)) {
        throw createAnalysisCancellationError();
      }

      if (error instanceof ApiError) {
        throw error;
      }

      lastError = error;

      if (attempt === SERVER_BROWSER_CONFIG.maxRetries) {
        break;
      }

      await abortableDelay(getBackoffDelay(attempt), signal);
    }
  }

  throw new ApiError(
    "NETWORK_ERROR",
    "No se pudo conectar con la API de Roblox.",
    { cause: lastError?.message ?? "" },
  );
}

function getRetryDelay(response, attempt) {
  const retryAfter = response.headers.get("Retry-After");

  return getRetryDelayFromHeader(retryAfter, attempt);
}

function getRetryDelayFromHeader(retryAfter, attempt) {

  if (retryAfter) {
    const seconds = Number(retryAfter);

    if (Number.isFinite(seconds)) {
      return Math.min(Math.max(seconds * 1000, 0), 30_000);
    }

    const retryDate = Date.parse(retryAfter);

    if (Number.isFinite(retryDate)) {
      return Math.min(Math.max(retryDate - Date.now(), 0), 30_000);
    }
  }

  return getBackoffDelay(attempt);
}

function getRetryAfterDurationMs(retryAfter, fallbackMs) {
  if (!retryAfter) {
    return fallbackMs;
  }

  const seconds = Number(retryAfter);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 24 * 60 * 60 * 1000);
  }

  const retryDate = Date.parse(retryAfter);

  if (Number.isFinite(retryDate)) {
    return Math.min(
      Math.max(retryDate - Date.now(), 0),
      24 * 60 * 60 * 1000,
    );
  }

  return fallbackMs;
}

function getBackoffDelay(attempt) {
  const exponential =
    SERVER_BROWSER_CONFIG.retryBaseDelayMs * 2 ** Math.max(attempt, 0);
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(exponential + jitter, 15_000);
}

function waitForRegionCheckSlot(signal = null) {
  const scheduled = regionCheckGate.then(async () => {
    const waitTime = Math.max(
      0,
      Math.max(nextRegionCheckAt, regionRateLimitedUntil) - Date.now(),
    );

    if (waitTime > 0) {
      await abortableDelay(waitTime, signal);
    }

    if (
      currentRegionChecksPerSecond <
        SERVER_BROWSER_CONFIG.regionChecksPerSecond &&
      Date.now() >= nextRegionRecoveryAt
    ) {
      currentRegionChecksPerSecond += 1;
      nextRegionRecoveryAt =
        Date.now() + SERVER_BROWSER_CONFIG.regionRateRecoveryStepMs;
    }

    const interval = 1000 / currentRegionChecksPerSecond;
    nextRegionCheckAt = Date.now() + interval;
  });

  regionCheckGate = scheduled.catch(() => {});
  return scheduled;
}

function registerRegionRateLimit(retryAfter) {
  currentRegionChecksPerSecond = Math.max(
    SERVER_BROWSER_CONFIG.minimumRegionChecksPerSecond,
    Math.floor(currentRegionChecksPerSecond / 2),
  );

  const cooldown = Math.min(
    getRetryAfterDurationMs(
      retryAfter,
      SERVER_BROWSER_CONFIG.regionRateLimitCooldownMs,
    ),
    60 * 1000,
  );
  regionRateLimitedUntil = Math.max(
    regionRateLimitedUntil,
    Date.now() + cooldown,
  );
  nextRegionRecoveryAt =
    regionRateLimitedUntil + SERVER_BROWSER_CONFIG.regionRateRecoveryStepMs;
}

async function readCachedRegion(placeId, jobId) {
  const key = getCacheKey(jobId);
  const stored = await chrome.storage.local.get(key);
  const entry = stored[key];

  if (
    !entry ||
    entry.cacheVersion !== CACHE_VERSION ||
    entry.placeId !== placeId ||
    entry.jobId !== jobId ||
    !Number.isFinite(entry.timestamp) ||
    Date.now() - entry.timestamp > SERVER_BROWSER_CONFIG.cacheTtlMs
  ) {
    if (entry) {
      await chrome.storage.local.remove(key);
    }

    return null;
  }

  return {
    dataCenterId: toNullableInteger(entry.dataCenterId),
    endpointAddress: normalizeIpAddress(entry.endpointAddress),
    jobId,
    placeId,
    region: normalizeRegion(entry.region),
    timestamp: entry.timestamp,
  };
}

async function maybeCleanupExpiredCache() {
  if (
    Date.now() - lastCacheCleanupAt <
    SERVER_BROWSER_CONFIG.cacheTtlMs
  ) {
    return;
  }

  await cleanupExpiredCache();
}

async function cleanupExpiredCache() {
  lastCacheCleanupAt = Date.now();
  const stored = await chrome.storage.local.get(null);
  const expiredKeys = Object.entries(stored)
    .filter(([key, value]) => {
      if (key.startsWith(CACHE_KEY_PREFIX)) {
        return (
          !value ||
          !Number.isFinite(value.timestamp) ||
          Date.now() - value.timestamp > SERVER_BROWSER_CONFIG.cacheTtlMs
        );
      }

      if (
        key.startsWith(DATA_CENTER_LOCATION_CACHE_KEY_PREFIX) ||
        key.startsWith(GEOLOCATION_CACHE_KEY_PREFIX)
      ) {
        return (
          !value ||
          !Number.isFinite(value.expiresAt) ||
          Date.now() >= value.expiresAt
        );
      }

      return false;
    })
    .map(([key]) => key);

  if (expiredKeys.length) {
    await chrome.storage.local.remove(expiredKeys);
  }
}

function getCacheKey(jobId) {
  return `${CACHE_KEY_PREFIX}${jobId}`;
}

function getGeolocationCacheKey(address) {
  return `${GEOLOCATION_CACHE_KEY_PREFIX}${address}`;
}

function getDataCenterLocationCacheKey(dataCenterId) {
  return `${DATA_CENTER_LOCATION_CACHE_KEY_PREFIX}${dataCenterId}`;
}

async function writeLocalCache(values) {
  try {
    await chrome.storage.local.set(values);
  } catch {
    // Cache failures must never hide an otherwise valid public server.
  }
}

function normalizeIpAddress(value) {
  if (typeof value !== "string") {
    return null;
  }

  const address = value.trim().toLowerCase();

  if (address.length < 3 || address.length > 45) {
    return null;
  }

  if (/^\d+(?:\.\d+){3}$/.test(address)) {
    const octets = address.split(".").map(Number);

    if (octets.every((octet) => Number.isInteger(octet) && octet <= 255)) {
      return octets.join(".");
    }

    return null;
  }

  if (
    address.includes(":") &&
    /^[0-9a-f:]+$/.test(address) &&
    !address.includes(":::") &&
    address.split(":").every((segment) => segment.length <= 4)
  ) {
    return address;
  }

  return null;
}

function normalizeGeoText(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, " ").slice(0, 100);
  return normalized || null;
}

function normalizeCountryCode(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}

function toNullableCoordinate(value, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum
    ? number
    : null;
}

function normalizeRegion(value) {
  const candidate =
    typeof value === "string"
      ? value
      : typeof value?.Name === "string"
        ? value.Name
        : "";
  const normalized = candidate.trim().toLowerCase();

  return normalized || null;
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toNonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
}

function toNullableInteger(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function clampInteger(value, minimum, maximum, fallback) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(Math.max(Math.round(number), minimum), maximum);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function serializeError(error) {
  if (error instanceof ApiError) {
    return {
      code: error.code,
      details: error.details,
      message: error.message,
    };
  }

  return {
    code: "UNEXPECTED_ERROR",
    details: {},
    message: "Ocurrió un error inesperado en la extensión.",
  };
}
