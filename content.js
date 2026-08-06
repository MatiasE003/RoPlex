document.documentElement.classList.add("roblox-extension-home-active");

const HOME_BOOTSTRAP_MESSAGE = "GET_HOME_BOOTSTRAP";
const HOME_FRIENDS_MESSAGE = "GET_HOME_FRIENDS";
const HOME_FRIEND_PREVIEW_MESSAGE = "GET_HOME_FRIEND_PREVIEW";
const JOIN_REQUEST_EVENT = "roblox-extension:join-server";
const JOIN_RESULT_EVENT = "roblox-extension:join-server-result";
const pendingHomeJoins = new Map();

document.addEventListener(JOIN_RESULT_EVENT, handleHomeJoinResult);

const icons = `
  <svg class="rx-icon-defs" aria-hidden="true"><symbol id="rx-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></symbol><symbol id="rx-home" viewBox="0 0 24 24"><path d="m3 11 9-8 9 8"></path><path d="M5 10v10h14V10M9 20v-6h6v6"></path></symbol><symbol id="rx-user" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"></circle><path d="M4 21a8 8 0 0 1 16 0"></path></symbol><symbol id="rx-users" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"></path></symbol><symbol id="rx-avatar" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"></circle><path d="M7 14h10l2 7H5l2-7Z"></path></symbol><symbol id="rx-box" viewBox="0 0 24 24"><path d="m4 7 8-4 8 4-8 4-8-4Z"></path><path d="M4 7v10l8 4 8-4V7M12 11v10"></path></symbol><symbol id="rx-message" viewBox="0 0 24 24"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"></path></symbol><symbol id="rx-more" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle></symbol><symbol id="rx-bell" viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"></path></symbol><symbol id="rx-gear" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"></circle><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1A7 7 0 0 0 15 6l-.3-2.6h-4L10.4 6A7 7 0 0 0 9 7L6.5 6l-2 3.4 2 1.5a7 7 0 0 0 0 2L4.5 14l2 3.4L9 17a7 7 0 0 0 1.5.9l.3 2.6h4l.3-2.6a7 7 0 0 0 1.5-.9l2.4.5 2-3.4-2-1.2a7 7 0 0 0 .1-1Z"></path></symbol><symbol id="rx-premium" viewBox="0 0 24 24"><path d="m12 3 3 6 6 .8-4.5 4.5 1.1 6.2L12 17.6l-5.6 2.9 1.1-6.2L3 9.8 9 9l3-6Z"></path></symbol><symbol id="rx-refresh" viewBox="0 0 24 24"><path d="M20 7v5h-5M4 17v-5h5"></path><path d="M18.5 9A7 7 0 0 0 6 6.5L4 9M5.5 15A7 7 0 0 0 18 17.5l2-2.5"></path></symbol></svg>
`;

const homeMarkup = `
  ${icons}
  <header class="rx-topbar">
    <a class="rx-brand" href="/home" aria-label="Roblox Home"><i class="rx-brand-mark"></i><span>ROBLOX</span></a>
    <nav class="rx-primary-nav" aria-label="Roblox sections"><a class="active" href="/home">Home</a><a href="/charts">Charts</a><a href="/catalog">Marketplace</a><a href="/create">Create</a></nav>
    <div class="rx-topbar-tools">
      <form class="rx-search" action="/discover/" method="get"><svg class="rx-icon"><use href="#rx-search"></use></svg><input name="Keyword" type="search" placeholder="Search" aria-label="Search Roblox" /></form>
      <a class="rx-top-icon" href="/notifications" aria-label="Notifications"><svg class="rx-icon"><use href="#rx-bell"></use></svg></a>
      <a class="rx-top-icon" href="/my/account" aria-label="Settings"><svg class="rx-icon"><use href="#rx-gear"></use></svg></a>
    </div>
  </header>
  <aside class="rx-sidebar">
    <a class="rx-user-summary" data-user-profile-link href="/home">
      <span class="rx-avatar" data-user-avatar><span data-user-initial>?</span></span>
      <span class="rx-user-copy"><strong data-user-display-name>Loading account</strong><small data-user-username>Please wait</small></span>
    </a>
    <nav aria-label="Account navigation"><ul class="rx-side-nav">
      <li><a class="active" href="/home"><svg class="rx-icon"><use href="#rx-home"></use></svg><span>Home</span></a></li>
      <li><a data-user-profile-link href="/home"><svg class="rx-icon"><use href="#rx-user"></use></svg><span>Profile</span></a></li>
      <li><a href="/my/messages/#!/inbox"><svg class="rx-icon"><use href="#rx-message"></use></svg><span>Messages</span></a></li>
      <li><a data-user-friends-link href="/home"><svg class="rx-icon"><use href="#rx-users"></use></svg><span>Friends</span></a></li>
      <li><a href="/my/avatar"><svg class="rx-icon"><use href="#rx-avatar"></use></svg><span>Avatar</span></a></li>
      <li><a data-user-inventory-link href="/home"><svg class="rx-icon"><use href="#rx-box"></use></svg><span>Inventory</span></a></li>
      <li><a href="/more"><svg class="rx-icon"><use href="#rx-more"></use></svg><span>More</span></a></li>
    </ul></nav>
    <a class="rx-premium-link" href="/premium/membership"><span class="rx-premium-icon"><svg class="rx-icon"><use href="#rx-premium"></use></svg></span><span>Get Premium</span></a>
  </aside>
  <main class="rx-main">
    <div class="rx-home-shell">
      <header class="rx-home-heading"><div><h1>Home</h1><p>Continue playing or find your next experience.</p></div></header>
      <section class="rx-bootstrap-card" aria-live="polite">
        <div class="rx-bootstrap-avatar" data-user-avatar><span data-user-initial>?</span></div>
        <div class="rx-bootstrap-copy"><span class="rx-eyebrow">Your Roblox account</span><h2 data-greeting>Connecting to Roblox...</h2><p data-bootstrap-status>Loading your authenticated profile and avatar.</p></div>
        <button class="rx-retry-button" data-retry hidden><svg class="rx-icon"><use href="#rx-refresh"></use></svg>Retry</button>
      </section>
      <section class="rx-section" id="rx-friends" aria-labelledby="rx-friends-title">
        <div class="rx-section-heading rx-friends-heading"><h2 id="rx-friends-title">Friends <span data-friends-count></span></h2><a class="rx-see-all" data-user-friends-link href="/home">See all</a></div>
        <div class="rx-friends-strip" data-friends-content aria-live="polite">
          <div class="rx-friend-skeleton"></div><div class="rx-friend-skeleton"></div><div class="rx-friend-skeleton"></div><div class="rx-friend-skeleton"></div><div class="rx-friend-skeleton"></div><div class="rx-friend-skeleton"></div><div class="rx-friend-skeleton"></div>
        </div>
      </section>
      <section class="rx-section" aria-labelledby="rx-home-content-title">
        <div class="rx-section-heading"><div><span class="rx-eyebrow">Next milestone</span><h2 id="rx-home-content-title">Your Home content</h2></div></div>
        <div class="rx-placeholder-grid" aria-label="Sections awaiting API integration">
          <article><span>01</span><h3>Continue</h3><p>Your recently played experiences will appear here.</p></article>
          <article><span>02</span><h3>Recommended</h3><p>Personalized discovery will appear here.</p></article>
          <article><span>03</span><h3>Favorites</h3><p>Your saved experiences will appear here.</p></article>
        </div>
      </section>
    </div>
  </main>
`;

function mountHome() {
  if (document.getElementById("roblox-extension-home")) {
    return;
  }

  const root = document.createElement("div");
  root.id = "roblox-extension-home";
  root.innerHTML = homeMarkup;
  document.body.prepend(root);
  root.querySelector("[data-retry]").addEventListener("click", loadBootstrap);
  loadBootstrap();
}

async function loadBootstrap() {
  const root = document.getElementById("roblox-extension-home");

  if (!root) {
    return;
  }

  setBootstrapState(root, "loading", "Connecting to Roblox...", "Loading your authenticated profile and avatar.");

  try {
    const data = await sendMessage({ type: HOME_BOOTSTRAP_MESSAGE });
    renderUser(root, data?.user);
    loadFriends(data.user.id);
  } catch (error) {
    const message = error?.message || "The account could not be loaded.";
    setBootstrapState(root, "error", "We couldn't load your account", message);
    renderFriendsBlocked(root);
  }
}

async function loadFriends(userId) {
  const root = document.getElementById("roblox-extension-home");

  if (!root) {
    return;
  }

  renderFriendsLoading(root);

  try {
    const data = await sendMessage({
      type: HOME_FRIENDS_MESSAGE,
      userId,
    });
    renderFriends(root, data);
  } catch (error) {
    renderFriendsError(
      root,
      error?.message || "Your friends could not be loaded.",
      userId,
    );
  }
}

function renderFriendsLoading(root) {
  const content = root.querySelector("[data-friends-content]");
  const skeletons = Array.from({ length: 7 }, () => {
    const skeleton = document.createElement("div");
    skeleton.className = "rx-friend-skeleton";
    return skeleton;
  });

  root.querySelector("[data-friends-count]").textContent = "";
  content.className = "rx-friends-strip";
  content.replaceChildren(...skeletons);
}

function renderFriends(root, data) {
  if (!data || !Number.isSafeInteger(data.count) || !Array.isArray(data.friends)) {
    throw new Error("Roblox returned an invalid friends list.");
  }

  const content = root.querySelector("[data-friends-content]");
  root.querySelector("[data-friends-count]").textContent = String(data.count);

  if (!data.friends.length) {
    content.className = "rx-friends-state";
    content.replaceChildren(createFriendsMessage("Your friends list is empty."));
    return;
  }

  const cards = data.friends.map(createFriendCard);
  content.className = "rx-friends-strip";
  content.replaceChildren(...cards);
}

function createFriendCard(friend) {
  const card = document.createElement("article");
  const avatar = document.createElement("span");
  const name = document.createElement("strong");
  const activity = document.createElement("small");
  const initial = Array.from(friend.displayName.trim())[0]?.toUpperCase() || "?";
  const popover = createFriendPopover(friend, initial);

  card.className = "rx-friend-card";
  card.dataset.presence = friend.status;
  card.dataset.previewState = "idle";
  card.tabIndex = 0;
  card.setAttribute("aria-label", `${friend.displayName}, ${friend.activity}`);
  card.setAttribute("aria-describedby", popover.id);
  avatar.className = "rx-friend-avatar";
  avatar.textContent = initial;
  name.textContent = friend.displayName;
  activity.textContent = friend.activity;

  setAvatarContent(avatar, friend.avatarUrl, initial);
  card.addEventListener("mouseenter", () => loadFriendPreview(card, friend));
  card.addEventListener("focusin", () => loadFriendPreview(card, friend));

  card.append(avatar, name, activity, popover);
  return card;
}

function createFriendPopover(friend, initial) {
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
  displayName.textContent = friend.displayName;
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
      type: HOME_FRIEND_PREVIEW_MESSAGE,
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
  count.textContent = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    notation: value >= 1000 ? "compact" : "standard",
  }).format(value);
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

function setAvatarContent(container, avatarUrl, initial) {
  container.textContent = initial;

  if (typeof avatarUrl !== "string" || !avatarUrl.startsWith("https://")) {
    return;
  }

  const image = document.createElement("img");
  image.alt = "";
  image.referrerPolicy = "no-referrer";
  image.src = avatarUrl;
  image.addEventListener("error", () => container.replaceChildren(initial), {
    once: true,
  });
  container.replaceChildren(image);
}

function startHomeJoin(button, status, placeId, jobId) {
  button.disabled = true;
  button.textContent = "Opening...";
  status.textContent = "";
  pendingHomeJoins.set(jobId, { button, status });
  document.dispatchEvent(
    new CustomEvent(JOIN_REQUEST_EVENT, {
      detail: JSON.stringify({ jobId, placeId }),
    }),
  );

  setTimeout(() => {
    const pending = pendingHomeJoins.get(jobId);

    if (pending?.button === button) {
      resetHomeJoin(jobId, pending);
    }
  }, 7000);
}

function handleHomeJoinResult(event) {
  let result;

  try {
    result = JSON.parse(event.detail);
  } catch {
    return;
  }

  const pending = pendingHomeJoins.get(result.jobId);

  if (!pending || result.ok) {
    return;
  }

  pending.status.textContent =
    result.message || "Roblox Player could not be opened.";
  resetHomeJoin(result.jobId, pending, false);
}

function resetHomeJoin(jobId, pending, clearStatus = true) {
  pending.button.disabled = false;
  pending.button.textContent = "Join";

  if (clearStatus) {
    pending.status.textContent = "";
  }

  pendingHomeJoins.delete(jobId);
}

function renderFriendsError(root, message, userId) {
  const content = root.querySelector("[data-friends-content]");
  const state = createFriendsMessage(message);
  const retry = document.createElement("button");
  retry.className = "rx-inline-retry";
  retry.type = "button";
  retry.textContent = "Retry";
  retry.addEventListener("click", () => loadFriends(userId), { once: true });
  state.append(retry);
  content.className = "rx-friends-state";
  content.replaceChildren(state);
}

function renderFriendsBlocked(root) {
  const content = root.querySelector("[data-friends-content]");
  root.querySelector("[data-friends-count]").textContent = "";
  content.className = "rx-friends-state";
  content.replaceChildren(
    createFriendsMessage("Load your Roblox account to see your friends."),
  );
}

function createFriendsMessage(message) {
  const state = document.createElement("div");
  const text = document.createElement("p");
  state.className = "rx-inline-state";
  text.textContent = message;
  state.append(text);
  return state;
}

function renderUser(root, user) {
  if (!user || !Number.isSafeInteger(user.id) || !user.displayName || !user.username) {
    throw new Error("Roblox returned an invalid account profile.");
  }

  const profileUrl = `/users/${user.id}/profile`;
  const initial = Array.from(user.displayName.trim())[0]?.toUpperCase() || "?";

  root.querySelectorAll("[data-user-display-name]").forEach((element) => {
    element.textContent = user.displayName;
  });
  root.querySelectorAll("[data-user-username]").forEach((element) => {
    element.textContent = `@${user.username}`;
  });
  root.querySelectorAll("[data-user-initial]").forEach((element) => {
    element.textContent = initial;
  });
  root.querySelectorAll("[data-user-profile-link]").forEach((element) => {
    element.href = profileUrl;
  });
  root.querySelectorAll("[data-user-friends-link]").forEach((element) => {
    element.href = `/users/${user.id}/friends#!/friends`;
  });
  root.querySelectorAll("[data-user-inventory-link]").forEach((element) => {
    element.href = `/users/${user.id}/inventory`;
  });

  if (typeof user.avatarUrl === "string" && user.avatarUrl.startsWith("https://")) {
    root.querySelectorAll("[data-user-avatar]").forEach((element) => {
      const image = document.createElement("img");
      image.alt = "";
      image.referrerPolicy = "no-referrer";
      image.src = user.avatarUrl;
      element.replaceChildren(image);
    });
  }

  setBootstrapState(root, "ready", `Welcome back, ${user.displayName}`, `Signed in as @${user.username}. Your Home shell is connected to Roblox.`);
}

function setBootstrapState(root, state, heading, status) {
  const card = root.querySelector(".rx-bootstrap-card");
  card.dataset.state = state;
  root.querySelector("[data-greeting]").textContent = heading;
  root.querySelector("[data-bootstrap-status]").textContent = status;
  root.querySelector("[data-retry]").hidden = state !== "error";
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!response?.ok) {
        reject(new Error(response?.error?.message || "The extension did not return a valid response."));
        return;
      }

      resolve(response.data);
    });
  });
}

if (document.body) {
  mountHome();
} else {
  document.addEventListener("DOMContentLoaded", mountHome, { once: true });
}
