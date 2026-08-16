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
const HOME_DISCOVERY_CACHE_TTL_MS = 30 * 1000;
const HOME_FRIEND_PREVIEW_CACHE_TTL_MS = 5 * 60 * 1000;
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

  const presenceType = Number(presence?.userPresenceType);
  const location = normalizeHomeText(presence?.lastLocation, 120);
  const gameId = normalizeHomeJobId(presence?.gameId);
  const placeId = Number(presence?.rootPlaceId || presence?.placeId);
  const universeId = Number(presence?.universeId);
  let activity = "Offline";
  let status = "offline";

  if (presenceType === 2) {
    activity = location && location !== "Website" ? location : "Playing";
    status = "playing";
  } else if (presenceType === 3) {
    activity = "Roblox Studio";
    status = "studio";
  } else if (presenceType === 1) {
    activity = "Online";
    status = "online";
  }

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
