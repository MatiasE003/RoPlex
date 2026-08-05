const SERVER_BROWSER_CONFIG = Object.freeze({
  cacheTtlMs: 5 * 60 * 1000,
  geolocationCacheTtlMs: 30 * 24 * 60 * 60 * 1000,
  geolocationErrorTtlMs: 10 * 60 * 1000,
  geolocationMaxRetries: 2,
  geolocationRequestsPerSecond: 10,
  initialRegionChecksPerSecond: 8,
  maxPages: 20,
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

  const placeId = parsePlaceId(message.placeId);

  if (message.type === "FETCH_PUBLIC_SERVERS") {
    await maybeCleanupExpiredCache();
    return fetchPublicServers(placeId, message.maxPages);
  }

  if (message.type === "GET_SERVER_REGION") {
    const jobId = parseJobId(message.jobId);
    const tabId = getRobloxTabId(sender);
    return getServerRegion(placeId, jobId, tabId);
  }

  throw new ApiError("UNKNOWN_REQUEST", "La operación solicitada no existe.");
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

async function fetchPublicServers(placeId, requestedMaxPages) {
  const maxPages = clampInteger(
    requestedMaxPages,
    1,
    SERVER_BROWSER_CONFIG.maxPages,
    SERVER_BROWSER_CONFIG.maxPages,
  );
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
    url.searchParams.set("sortOrder", "Asc");
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
  } while (cursor && pagesFetched < maxPages);

  return {
    pagesFetched,
    servers,
    truncated: Boolean(cursor),
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

async function fetchJoinPayloadWithRetry(placeId, jobId, tabId) {
  let lastPayload = null;

  for (
    let attempt = 0;
    attempt <= SERVER_BROWSER_CONFIG.maxRetries;
    attempt += 1
  ) {
    await waitForRegionCheckSlot();

    const response = await executeJoinRequestInPage(tabId, placeId, jobId);

    if (response.networkError) {
      if (attempt === SERVER_BROWSER_CONFIG.maxRetries) {
        throw new ApiError(
          "NETWORK_ERROR",
          "No se pudo conectar con la API de Roblox desde la página.",
          { cause: response.networkError },
        );
      }

      await delay(getBackoffDelay(attempt));
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

      await delay(getRetryDelayFromHeader(response.retryAfter, attempt));
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
    await delay(getBackoffDelay(attempt));
  }

  return lastPayload;
}

async function executeJoinRequestInPage(tabId, placeId, jobId) {
  try {
    const results = await chrome.scripting.executeScript({
      args: [placeId, jobId],
      func: async (requestPlaceId, requestJobId) => {
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
            networkError:
              error instanceof Error ? error.message : "Unknown fetch error",
          };
        }
      },
      target: { tabId },
      world: "MAIN",
    });

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

async function readCachedDataCenterLocation(dataCenterId) {
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

async function readCachedGeolocation(address) {
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

function waitForGeolocationSlot() {
  const interval =
    1000 / SERVER_BROWSER_CONFIG.geolocationRequestsPerSecond;

  const scheduled = geolocationGate.then(async () => {
    const waitTime = Math.max(0, nextGeolocationCheckAt - Date.now());

    if (waitTime > 0) {
      await delay(waitTime);
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

  for (
    let attempt = 0;
    attempt <= SERVER_BROWSER_CONFIG.maxRetries;
    attempt += 1
  ) {
    try {
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

        await delay(getRetryDelay(response, attempt));
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
      if (error instanceof ApiError) {
        throw error;
      }

      lastError = error;

      if (attempt === SERVER_BROWSER_CONFIG.maxRetries) {
        break;
      }

      await delay(getBackoffDelay(attempt));
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

function waitForRegionCheckSlot() {
  const scheduled = regionCheckGate.then(async () => {
    const waitTime = Math.max(
      0,
      Math.max(nextRegionCheckAt, regionRateLimitedUntil) - Date.now(),
    );

    if (waitTime > 0) {
      await delay(waitTime);
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
