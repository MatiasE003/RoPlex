import {
  formatCompactNumber,
  handleHorizontalCarouselWheel,
  setAvatarContent,
} from "./ui.js";

const numberFormat = new Intl.NumberFormat("en-US");
const dateFormat = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

export function renderProfileBootstrap(container, data, options) {
  const profile = data?.profile || data?.targetUser || data?.user || data;
  const viewer = data?.viewer || data?.authenticatedUser || null;
  const userId = positiveId(profile?.id) || options.userId;
  const displayName = text(profile?.displayName);
  const username = text(profile?.username || profile?.name);
  const customName = text(profile?.customName);

  if (!positiveId(userId) || !displayName || !username) {
    throw new Error("Roblox returned an invalid profile.");
  }

  const primaryName = customName || displayName;
  const card = element("header", "rx-profile-card");
  const cover = element("div", "rx-profile-cover");
  const identity = element("div", "rx-profile-identity");
  const avatar = element("div", "rx-profile-avatar");
  const copy = element("div", "rx-profile-identity-copy");
  const heading = element("div", "rx-profile-identity-heading");
  const title = element("h1", "", primaryName);
  const canonical = element(
    "p",
    "rx-profile-username",
    customName ? `${displayName} · @${username}` : `@${username}`,
  );
  const meta = element("div", "rx-profile-meta");
  const actions = element("div", "rx-profile-actions");
  const actionStatus = element("p", "rx-profile-action-status");

  cover.append(element("div", "rx-profile-cover-grid"));
  setAvatarContent(
    avatar,
    profile.avatarUrl || profile.headshotUrl,
    Array.from(primaryName)[0]?.toUpperCase() || "?",
  );
  avatar.setAttribute("aria-label", `${primaryName}'s avatar`);
  heading.append(title);
  if (profile.hasVerifiedBadge || profile.isVerified) {
    const verified = element("span", "rx-profile-verified", "✓");
    verified.title = "Verified";
    heading.append(verified);
  }
  copy.append(heading, canonical);

  const presence = text(profile.presenceLabel || profile.presence);
  if (presence) {
    const presenceNode = element("span", "rx-profile-presence", presence);
    presenceNode.dataset.presence = text(profile.presenceStatus).toLowerCase();
    meta.append(presenceNode);
  }
  const joined = formatDate(profile.created || profile.joinedAt || profile.createdAt);
  if (joined) {
    meta.append(iconLabel("rx-calendar", `Joined ${joined}`));
  }
  copy.append(meta);

  const viewerId = positiveId(viewer?.id);
  const isOwnProfile = Boolean(data?.isOwnProfile) || viewerId === userId;
  if (viewerId && !isOwnProfile) {
    const friendshipLabel = friendLabel(profile, data);
    const message = element("a", "rx-profile-secondary-button", "Message");
    message.href = `/my/messages/compose?recipientId=${userId}`;
    message.prepend(svgIcon("rx-message"));

    if (
      friendshipLabel === "Add Friend" ||
      friendshipLabel === "Request Pending" ||
      friendshipLabel === "Request Received"
    ) {
      const friend = createActionButton(
        friendshipLabel,
        "rx-profile-primary-button",
        options.onFriend,
        actionStatus,
        "Sending...",
        "Friend request sent",
      );
      friend.disabled = friendshipLabel !== "Add Friend";
      friend.prepend(svgIcon("rx-user-plus"));
      actions.append(friend);
    }

    actions.append(message);

    if (typeof data?.isFollowing === "boolean") {
      const follow = createActionButton(
        followLabel(profile, data),
        "rx-profile-secondary-button",
        options.onFollow,
        actionStatus,
        "Following...",
        "Following",
      );
      follow.disabled = data.isFollowing;
      actions.append(follow);
    }
  }

  identity.append(avatar, copy);
  if (actions.childElementCount) {
    identity.append(actions);
  }
  card.append(cover, identity, createProfileStats(profile, data), actionStatus);

  const account = createPanel("Public Account Info", "rx-profile-account");
  const details = element("div", "rx-profile-details");
  details.append(
    detail("Joined", joined || "Unavailable"),
    detail("User ID", String(userId)),
    detail(
      "Verified badge",
      profile.hasVerifiedBadge || profile.isVerified ? "Yes" : "No",
    ),
    detail("Account status", profile.isBanned ? "Unavailable" : "Active"),
  );
  account.body.append(details);
  container.replaceChildren(card);
  if (options.accountContainer) {
    options.accountContainer.replaceChildren(account.section);
  } else {
    container.append(account.section);
  }
  return { profile, viewer };
}

export function renderProfileAvatar(container, data, userId) {
  const avatarData = data?.avatar || data || {};
  const assets = arrayFrom(data, "assets", "equippedAssets", "items");
  const panel = createPanel("Currently Wearing", "rx-profile-wearing");
  const card = element("div", "rx-profile-wearing-card");
  const avatar = element("a", "rx-profile-wearing-avatar");
  const image = safeImage(
    avatarData.avatarUrl || avatarData.imageUrl || data?.avatarUrl,
    "Current Roblox avatar",
  );
  avatar.href = `/users/${userId}/inventory`;
  avatar.append(image || element("span", "rx-profile-image-fallback", "Avatar"));

  const copy = element("div", "rx-profile-wearing-copy");
  copy.append(
    element("h3", "", "Equipped avatar"),
    element(
      "p",
      "",
      assets.length
        ? `${numberFormat.format(assets.length)} equipped items`
        : "No public equipped assets were returned.",
    ),
  );
  const grid = element("div", "rx-profile-wearing-items");
  assets.forEach((asset) => grid.append(createAssetCard(asset, userId)));
  if (assets.length) {
    copy.append(grid);
  }
  card.append(avatar, copy);
  panel.section.addEventListener(
    "wheel",
    (event) => handleHorizontalCarouselWheel(event, grid),
    { passive: false },
  );
  panel.body.append(card);
  container.replaceChildren(panel.section);
}

export function renderProfileCreations(container, data) {
  renderGamesSection(container, data, {
    arrayKeys: ["creations", "games", "items"],
    className: "rx-profile-creation-grid",
    empty: "This user has no public experiences.",
    title: "Creations",
  });
}

export function renderProfileFavorites(container, data) {
  renderGamesSection(container, data, {
    arrayKeys: ["favorites", "games", "items"],
    className: "rx-profile-favorite-grid",
    compact: true,
    empty: "This user has no public favorite experiences.",
    title: "Favorites",
  });
}

export async function renderProfileFriends(container, data, _userId, options) {
  const friends = arrayFrom(data, "friends", "users", "items");
  const panel = createPanel("Friends", "rx-profile-friends", friends.length);
  if (!friends.length) {
    panel.body.append(emptyState("This user has no public friends."));
  } else {
    const grid = element("div", "rx-profile-friend-grid");
    panel.body.append(grid);
    container.replaceChildren(panel.section);
    await appendInBatches(grid, friends, createFriendCard, options?.isCurrent);
    return;
  }
  container.replaceChildren(panel.section);
}

export async function renderProfileCommunities(container, data, _userId, options) {
  const communities = arrayFrom(data, "communities", "groups", "items");
  const panel = createPanel("Communities", "rx-profile-communities", communities.length);
  if (!communities.length) {
    panel.body.append(emptyState("This user has no public communities."));
  } else {
    const grid = element("div", "rx-profile-community-grid");
    panel.body.append(grid);
    container.replaceChildren(panel.section);
    await appendInBatches(
      grid,
      communities,
      createCommunityCard,
      options?.isCurrent,
    );
    return;
  }
  container.replaceChildren(panel.section);
}

export function renderProfileBadges(container, data) {
  const badges = arrayFrom(data, "badges", "items");
  const panel = createPanel("Badges", "rx-profile-badges", badges.length);
  if (!badges.length) {
    panel.body.append(emptyState("This user has no public badges."));
  } else {
    const grid = element("div", "rx-profile-badge-grid");
    badges.forEach((badge) => {
      const badgeId = positiveId(badge?.id || badge?.badgeId);
      const name = text(badge?.name) || "Roblox badge";
      const link = element("a", "rx-profile-badge-card");
      const visual = element("span", "rx-profile-badge-image");
      const image = safeImage(badge?.imageUrl || badge?.thumbnailUrl, name);
      link.href = badgeId ? `/badges/${badgeId}` : "/badges";
      visual.append(image || svgIcon("rx-award"));
      const copy = element("span", "rx-profile-card-copy");
      copy.append(
        element("strong", "", name),
        element("small", "", text(badge?.description) || "Roblox badge"),
      );
      link.append(visual, copy);
      grid.append(link);
    });
    panel.body.append(grid);
    if (data?.truncated) {
      panel.body.append(
        truncatedNotice(
          `Showing the latest ${numberFormat.format(badges.length)} badges returned by Roblox.`,
        ),
      );
    }
  }
  container.replaceChildren(panel.section);
}

export function renderProfileSectionState(container, message, retry) {
  const state = element("div", "rx-profile-section-state", message);
  if (retry) {
    const button = element("button", "rx-profile-retry", "Retry");
    button.type = "button";
    button.addEventListener("click", retry, { once: true });
    state.append(button);
  }
  container.replaceChildren(state);
}

function renderGamesSection(container, data, config) {
  const games = arrayFrom(data, ...config.arrayKeys);
  const panel = createPanel(config.title, `rx-profile-${config.title.toLowerCase()}`, games.length);
  if (!games.length) {
    panel.body.append(emptyState(config.empty));
  } else {
    const grid = element("div", config.className);
    games.forEach((game) => grid.append(createGameCard(game, config.compact)));
    panel.body.append(grid);
    if (data?.truncated) {
      panel.body.append(
        truncatedNotice(
          `Showing the first ${numberFormat.format(games.length)} public experiences returned by Roblox.`,
        ),
      );
    }
  }
  container.replaceChildren(panel.section);
}

function createGameCard(game, compact) {
  const placeId = positiveId(game?.placeId || game?.rootPlaceId || game?.id);
  const name = text(game?.name) || "Roblox experience";
  const link = element("a", compact ? "rx-profile-favorite-card" : "rx-profile-game-card");
  const visual = element("span", "rx-profile-game-image");
  const image = safeImage(game?.thumbnailUrl || game?.imageUrl, name);
  link.href = placeId ? `/games/${placeId}` : "/charts";
  visual.append(image || element("span", "rx-profile-image-fallback", initials(name)));
  const copy = element("span", "rx-profile-card-copy");
  const stats = [];
  const rating = nonNegativeNumber(game?.rating ?? game?.votePercentage);
  const playing = nonNegativeNumber(game?.playing ?? game?.playerCount);
  if (rating !== null) stats.push(`${Math.round(rating)}%`);
  if (playing !== null) stats.push(`${formatCompactNumber(playing)} playing`);
  copy.append(
    element("strong", "", name),
    element("small", "", stats.join(" · ") || "View experience"),
  );
  link.append(visual, copy);
  return link;
}

function createAssetCard(asset, userId) {
  const card = element("a", "rx-profile-asset-card");
  const visual = element("span", "rx-profile-asset-image");
  const assetId = positiveId(asset?.id || asset?.assetId);
  const name = text(asset?.name) || "Equipped asset";
  const image = safeImage(asset?.thumbnailUrl || asset?.imageUrl, name);
  card.href = assetId ? `/catalog/${assetId}` : `/users/${userId}/inventory`;
  visual.append(image || element("span", "rx-profile-image-fallback", initials(name)));
  const copy = element("span", "rx-profile-card-copy");
  const price = nonNegativeNumber(asset?.priceInRobux);
  const priceNode = element("small", "rx-profile-asset-price");

  if (price === 0) {
    priceNode.textContent = "Free";
  } else if (price !== null) {
    priceNode.append(
      svgIcon("rx-robux"),
      document.createTextNode(numberFormat.format(Math.round(price))),
    );
  } else {
    priceNode.textContent =
      asset?.isForSale === false ? "Off sale" : "Price unavailable";
  }

  copy.append(
    element("strong", "", name),
    element("small", "", text(asset?.assetType || asset?.typeName || asset?.type) || "Avatar item"),
    priceNode,
  );
  card.append(visual, copy);
  return card;
}

function createFriendCard(friend) {
  const userId = positiveId(friend?.id || friend?.userId);
  const displayName =
    text(friend?.displayName) || text(friend?.username) || "Roblox user";
  const customName = text(friend?.customName);
  const username = text(friend?.username || friend?.name);
  const link = element("a", "rx-profile-friend-card");
  const avatar = element("span", "rx-profile-friend-avatar");
  if (userId) {
    link.href = `/users/${userId}/profile`;
  }
  setAvatarContent(
    avatar,
    friend?.avatarUrl || friend?.headshotUrl,
    Array.from(customName || displayName)[0]?.toUpperCase() || "?",
    { decoding: "async", loading: "lazy" },
  );
  const copy = element("span", "rx-profile-card-copy");
  copy.append(
    element("strong", "", customName || displayName),
    element(
      "small",
      "",
      customName
        ? `${displayName}${username ? ` · @${username}` : ""}`
        : username
          ? `@${username}`
          : "Roblox user",
    ),
  );
  link.append(avatar, copy);
  return link;
}

function createCommunityCard(community) {
  const group = community?.group || community;
  const groupId = positiveId(group?.id || community?.groupId);
  const name = text(group?.name) || "Roblox community";
  const link = element("a", "rx-profile-community-card");
  const visual = element("span", "rx-profile-community-image");
  const image = safeImage(group?.imageUrl || group?.thumbnailUrl, name);
  link.href = groupId ? `/communities/${groupId}` : "/communities";
  visual.append(image || document.createTextNode(initials(name)));
  const copy = element("span", "rx-profile-card-copy");
  const memberCount = nonNegativeNumber(
    group?.memberCount || community?.memberCount,
  );
  const role = text(community?.role?.name || community?.roleName) || "Member";
  copy.append(
    element("strong", "", name),
    element(
      "small",
      "",
      memberCount === null
        ? role
        : `${role} · ${formatCompactNumber(memberCount)} members`,
    ),
  );
  link.append(visual, copy);
  return link;
}

async function appendInBatches(container, items, createItem, isCurrent) {
  const batchSize = 24;

  for (let index = 0; index < items.length; index += batchSize) {
    if (typeof isCurrent === "function" && !isCurrent()) return;
    if (index) await waitForRenderOpportunity();
    if (typeof isCurrent === "function" && !isCurrent()) return;
    const fragment = document.createDocumentFragment();
    items
      .slice(index, index + batchSize)
      .forEach((item) => fragment.append(createItem(item)));
    container.append(fragment);
  }
}

function waitForRenderOpportunity() {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(resolve, { timeout: 100 });
    } else {
      requestAnimationFrame(resolve);
    }
  });
}

function createProfileStats(profile, data) {
  const stats = element("div", "rx-profile-stats");
  const values = [
    [profile.friendCount ?? data?.friendCount, "Friends"],
    [profile.followerCount ?? data?.followerCount, "Followers"],
    [profile.followingCount ?? data?.followingCount, "Following"],
  ];
  values.forEach(([value, label]) => {
    const item = element("div", "rx-profile-stat");
    const count = nonNegativeNumber(value);
    item.append(
      element("b", "", count === null ? "--" : formatCompactNumber(count)),
      element("span", "", label),
    );
    stats.append(item);
  });
  const description = text(profile.description || profile.about || profile.status);
  if (description) {
    stats.append(element("p", "rx-profile-description", description));
  }
  return stats;
}

function createActionButton(label, className, handler, status, pending, success) {
  const button = element("button", className, label);
  button.type = "button";
  button.addEventListener("click", async () => {
    if (button.disabled || typeof handler !== "function") return;
    button.disabled = true;
    button.textContent = pending;
    status.dataset.state = "pending";
    status.textContent = pending;
    try {
      await handler();
      button.textContent = success;
      status.dataset.state = "success";
      status.textContent = success;
    } catch (error) {
      button.disabled = false;
      button.textContent = label;
      status.dataset.state = "error";
      status.textContent = actionErrorMessage(error);
    }
  });
  return button;
}

function actionErrorMessage(error) {
  const detail = typeof error?.details?.message === "string" ? error.details.message : "";
  return detail || error?.message || (error?.code ? `Roblox error: ${error.code}` : "The action could not be completed.");
}

function friendLabel(profile, data) {
  const status = text(data?.friendshipStatus || profile?.friendshipStatus).toLowerCase();
  if (status === "requestsent" || status.includes("pending")) return "Request Pending";
  if (status === "requestreceived") return "Request Received";
  if (status.includes("friend")) return "Friends";
  if (status === "unknown") return "Unknown";
  return "Add Friend";
}

function followLabel(profile, data) {
  return data?.isFollowing || profile?.isFollowing ? "Following" : "Follow";
}

function createPanel(title, className, count) {
  const section = element("section", `rx-profile-panel ${className}`);
  const body = element("div", "rx-profile-panel-content");
  const heading = element("div", "rx-profile-panel-heading");
  const titleNode = element("h2", "", title);
  if (Number.isSafeInteger(count)) {
    titleNode.append(element("span", "", numberFormat.format(count)));
  }
  heading.append(titleNode);
  body.append(heading);
  section.append(body);
  return { body, section };
}

function detail(label, value) {
  const item = element("div", "rx-profile-detail");
  item.append(element("span", "", label), element("b", "", value));
  return item;
}

function emptyState(message) {
  return element("div", "rx-profile-empty", message);
}

function truncatedNotice(message) {
  return element("p", "rx-profile-truncated", message);
}

function iconLabel(icon, label) {
  const node = element("span");
  node.append(svgIcon(icon), document.createTextNode(label));
  return node;
}

function svgIcon(id) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  svg.setAttribute("class", "rx-icon");
  use.setAttribute("href", `#${id}`);
  svg.append(use);
  return svg;
}

function safeImage(url, alt) {
  if (typeof url !== "string" || !url.startsWith("https://")) return null;
  const image = document.createElement("img");
  image.alt = alt;
  image.decoding = "async";
  image.loading = "lazy";
  image.referrerPolicy = "no-referrer";
  image.src = url;
  return image;
}

function arrayFrom(data, ...keys) {
  if (Array.isArray(data)) return data;
  for (const key of keys) {
    if (Array.isArray(data?.[key])) return data[key];
    if (Array.isArray(data?.data?.[key])) return data.data[key];
  }
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function positiveId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function nonNegativeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : dateFormat.format(date);
}

function initials(value) {
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => Array.from(part)[0] || "")
    .join("")
    .toUpperCase();
}

function element(tag, className = "", content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}
