import { EVENTS, MESSAGE_TYPES } from "../shared/config.js";
import { sendMessage, startHomeJoin } from "../shared/messaging.js";
import {
  createInlineState,
  createRetryButton,
  formatCompactNumber,
  setAvatarContent,
} from "../shared/ui.js";

// Stateful custom elements own their lifecycle and request state.
export class FriendsList extends HTMLElement {
  connectedCallback() {
    if (this.content) {
      this.addUserEventListeners();
      return;
    }

    this.innerHTML = `
      <section class="rx-section" id="rx-friends" aria-labelledby="rx-friends-title">
        <div class="rx-section-heading rx-friends-heading"><h2 id="rx-friends-title">Friends <span data-friends-count></span></h2><a class="rx-see-all" data-user-friends-link href="/home">See all</a></div>
        <div class="rx-friends-strip" data-friends-content aria-live="polite"></div>
      </section>
    `;
    this.count = this.querySelector("[data-friends-count]");
    this.content = this.querySelector("[data-friends-content]");
    this.handleUserReady = (event) => this.load(event.detail.userId);
    this.handleUserError = () => this.renderBlocked();
    this.handleHomeRefresh = () => {
      this.requestId = (this.requestId || 0) + 1;
      this.renderLoading();
    };
    this.addUserEventListeners();
    this.renderLoading();
  }

  disconnectedCallback() {
    this.requestId = (this.requestId || 0) + 1;
    document.removeEventListener(EVENTS.userReady, this.handleUserReady);
    document.removeEventListener(EVENTS.userError, this.handleUserError);
    document.removeEventListener(EVENTS.homeRefresh, this.handleHomeRefresh);
  }

  addUserEventListeners() {
    document.addEventListener(EVENTS.userReady, this.handleUserReady);
    document.addEventListener(EVENTS.userError, this.handleUserError);
    document.addEventListener(EVENTS.homeRefresh, this.handleHomeRefresh);
  }

  async load(userId = this.userId) {
    this.userId = userId;
    const requestId = (this.requestId || 0) + 1;
    this.requestId = requestId;
    this.renderLoading();

    try {
      const data = await sendMessage({
        type: MESSAGE_TYPES.friends,
        userId,
      });

      if (requestId === this.requestId && this.isConnected) {
        this.renderFriends(data);
      }
    } catch (error) {
      if (requestId === this.requestId && this.isConnected) {
        this.renderError(error?.message || "Your friends could not be loaded.");
      }
    }
  }

  renderLoading() {
    this.count.textContent = "";
    this.content.className = "rx-friends-strip";
    this.content.replaceChildren(
      ...Array.from({ length: 7 }, () => {
        const skeleton = document.createElement("div");
        skeleton.className = "rx-friend-skeleton";
        return skeleton;
      }),
    );
  }

  renderFriends(data) {
    if (
      !data ||
      !Number.isSafeInteger(data.count) ||
      !Array.isArray(data.friends)
    ) {
      throw new Error("Roblox returned an invalid friends list.");
    }

    this.count.textContent = String(data.count);

    if (!data.friends.length) {
      this.renderMessage("Your friends list is empty.");
      return;
    }

    this.content.className = "rx-friends-strip";
    this.content.replaceChildren(...data.friends.map(createFriendCard));
  }

  renderError(message) {
    const state = createInlineState(message);
    state.append(createRetryButton(() => this.load()));
    this.content.className = "rx-friends-state";
    this.content.replaceChildren(state);
  }

  renderBlocked() {
    this.requestId = (this.requestId || 0) + 1;
    this.count.textContent = "";
    this.renderMessage("Load your Roblox account to see your friends.");
  }

  renderMessage(message) {
    this.content.className = "rx-friends-state";
    this.content.replaceChildren(createInlineState(message));
  }
}

// Presentation helpers are stateless: data in, DOM node out.
function createFriendCard(friend) {
  const card = document.createElement("article");
  const avatar = document.createElement("span");
  const name = document.createElement("strong");
  const activity = document.createElement("small");
  const friendName = friend.customName || friend.displayName;
  const initial = Array.from(friendName.trim())[0]?.toUpperCase() || "?";
  const popover = createFriendPopover(friend, initial, friendName);

  card.className = "rx-friend-card";
  card.dataset.presence = friend.status;
  card.dataset.previewState = "idle";
  card.tabIndex = 0;
  card.setAttribute("aria-label", `${friendName}, ${friend.activity}`);
  card.setAttribute("aria-describedby", popover.id);
  avatar.className = "rx-friend-avatar";
  avatar.textContent = initial;
  name.textContent = friendName;
  activity.textContent = friend.activity;

  setAvatarContent(avatar, friend.avatarUrl, initial);
  card.addEventListener("mouseenter", () => loadFriendPreview(card, friend));
  card.addEventListener("focusin", () => loadFriendPreview(card, friend));

  card.append(avatar, name, activity, popover);
  return card;
}

function createFriendPopover(friend, initial, friendName) {
  const popover = document.createElement("aside");
  const profile = document.createElement("div");
  const avatar = document.createElement("span");
  const name = document.createElement("div");
  const displayName = document.createElement("strong");
  const username = document.createElement("span");
  const presence = document.createElement("i");
  const body = document.createElement("div");
  const profileLink = document.createElement("a");

  popover.className = "rx-friend-popover";
  popover.id = `rx-friend-${friend.id}-preview`;
  popover.role = "tooltip";
  profile.className = "rx-popover-profile";
  avatar.className = "rx-popover-avatar";
  name.className = "rx-popover-name";
  displayName.textContent = friendName;
  username.textContent = `@${friend.username}`;
  presence.className = `rx-presence-badge ${friend.status}`;
  presence.textContent = getPresenceLabel(friend.status);
  body.className = "rx-friend-preview-body";
  body.append(createPreviewMessage("Loading profile...", "loading"));
  profileLink.className = "rx-profile-button";
  profileLink.href = `/users/${friend.id}/profile`;
  profileLink.textContent = "View profile";
  setAvatarContent(avatar, friend.avatarUrl, initial);
  name.append(displayName, username);
  profile.append(avatar, name, presence);
  popover.append(profile, body, profileLink);
  return popover;
}

async function loadFriendPreview(card, friend) {
  if (card.dataset.previewState !== "idle") {
    return;
  }

  card.dataset.previewState = "loading";
  const body = card.querySelector(".rx-friend-preview-body");
  body.replaceChildren(createPreviewMessage("Loading profile...", "loading"));

  try {
    const data = await sendMessage({
      type: MESSAGE_TYPES.friendPreview,
      universeId: friend.universeId,
      userId: friend.id,
    });
    renderFriendPreview(body, friend, data);
    card.dataset.previewState = "ready";
  } catch (error) {
    card.dataset.previewState = "error";
    renderFriendPreviewError(
      body,
      error?.message || "The profile preview could not be loaded.",
      card,
      friend,
    );
  }
}

function renderFriendPreview(body, friend, data) {
  if (
    !data ||
    !data.stats ||
    !Number.isSafeInteger(data.stats.friends) ||
    !Number.isSafeInteger(data.stats.followers) ||
    !Number.isSafeInteger(data.stats.following) ||
    !Number.isFinite(Date.parse(data.created))
  ) {
    throw new Error("Roblox returned an invalid friend preview.");
  }

  const stats = document.createElement("div");
  const joined = document.createElement("div");
  const joinedLabel = document.createElement("span");
  const joinedDate = document.createElement("b");
  stats.className = "rx-account-stats";
  stats.append(
    createAccountStat(data.stats.friends, "Friends"),
    createAccountStat(data.stats.followers, "Followers"),
    createAccountStat(data.stats.following, "Following"),
  );
  joined.className = "rx-account-detail";
  joinedLabel.textContent = "Joined Roblox";
  joinedDate.textContent = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(data.created));
  joined.append(joinedLabel, joinedDate);

  const content = [stats, joined];
  const activity = createFriendActivity(friend, data.game);

  if (activity) {
    content.push(activity);
  }

  body.replaceChildren(...content);
}

function createAccountStat(value, label) {
  const stat = document.createElement("div");
  const count = document.createElement("b");
  const name = document.createElement("span");
  stat.className = "rx-account-stat";
  count.textContent = formatCompactNumber(value);
  name.textContent = label;
  stat.append(count, name);
  return stat;
}

function createFriendActivity(friend, game) {
  if (friend.status === "playing" && game) {
    const activity = document.createElement("div");
    const image = document.createElement("span");
    const copy = document.createElement("div");
    const label = document.createElement("span");
    const name = document.createElement("strong");
    activity.className = "rx-playing-card";
    image.className = "rx-playing-image";
    copy.className = "rx-playing-copy";
    label.textContent = "Playing now";
    name.textContent = game.name;

    if (game.imageUrl) {
      const thumbnail = document.createElement("img");
      thumbnail.alt = "";
      thumbnail.referrerPolicy = "no-referrer";
      thumbnail.src = game.imageUrl;
      image.append(thumbnail);
    }

    copy.append(label, name);
    activity.append(image, copy);

    if (friend.gameId && (game.placeId || friend.placeId)) {
      const join = document.createElement("button");
      const joinStatus = document.createElement("span");
      join.className = "rx-join-button";
      join.type = "button";
      join.textContent = "Join";
      join.addEventListener("click", () =>
        startHomeJoin(
          join,
          joinStatus,
          game.placeId || friend.placeId,
          friend.gameId,
        ),
      );
      activity.append(join);
      joinStatus.className = "rx-join-status";
      activity.append(joinStatus);
    }

    return activity;
  }

  if (friend.status === "playing") {
    const activity = document.createElement("div");
    activity.className = "rx-private-activity";
    activity.textContent =
      "This user's current experience is hidden by their privacy settings.";
    return activity;
  }

  if (friend.status === "online" || friend.status === "studio") {
    const activity = document.createElement("div");
    activity.className = "rx-private-activity";
    activity.textContent =
      friend.status === "studio"
        ? "Working in Roblox Studio."
        : "Online on Roblox, not currently in an experience.";
    return activity;
  }

  return null;
}

function renderFriendPreviewError(body, message, card, friend) {
  const state = createPreviewMessage(message, "error");
  const retry = document.createElement("button");
  retry.className = "rx-preview-retry";
  retry.type = "button";
  retry.textContent = "Retry";
  retry.addEventListener(
    "click",
    () => {
      card.dataset.previewState = "idle";
      loadFriendPreview(card, friend);
    },
    { once: true },
  );
  state.append(retry);
  body.replaceChildren(state);
}

function createPreviewMessage(message, state) {
  const element = document.createElement("div");
  element.className = `rx-preview-message ${state}`;
  element.textContent = message;
  return element;
}

function getPresenceLabel(status) {
  return {
    offline: "Offline",
    online: "Online",
    playing: "Playing",
    studio: "Studio",
  }[status] || "Offline";
}
