document.documentElement.classList.add("roblox-extension-home-active");

const HOME_BOOTSTRAP_MESSAGE = "GET_HOME_BOOTSTRAP";
const HOME_FRIENDS_MESSAGE = "GET_HOME_FRIENDS";
const HOME_FRIEND_PREVIEW_MESSAGE = "GET_HOME_FRIEND_PREVIEW";
const HOME_CONTINUE_MESSAGE = "GET_HOME_CONTINUE";
const HOME_FAVORITES_MESSAGE = "GET_HOME_FAVORITES";
const HOME_RECOMMENDED_MESSAGE = "GET_HOME_RECOMMENDED";
const HOME_USER_SEARCH_MESSAGE = "SEARCH_HOME_USERS";
const HOME_USER_READY_EVENT = "roblox-extension:user-ready";
const HOME_USER_ERROR_EVENT = "roblox-extension:user-error";
const HOME_REFRESH_EVENT = "roblox-extension:home-refresh";
const ROUTE_CHANGE_EVENT = "roblox-extension:route-change";
const COMPONENT_CONNECTED_EVENT = "roblox-extension:component-connected";
const COMPONENT_DISCONNECTED_EVENT = "roblox-extension:component-disconnected";
const JOIN_REQUEST_EVENT = "roblox-extension:join-server";
const JOIN_RESULT_EVENT = "roblox-extension:join-server-result";
const pendingHomeJoins = new Map();

const GAME_FEEDS = {
  continue: {
    ariaLabel: "Recently played experiences",
    emptyMessage: "Play an experience and it will appear here.",
    errorMessage: "Your recently played experiences could not be loaded.",
    invalidMessage: "Roblox returned an invalid Continue list.",
    messageType: HOME_CONTINUE_MESSAGE,
    title: "Continue",
  },
  favorites: {
    ariaLabel: "Favorite experiences",
    blockedMessage: "Sign in to load your favorite experiences.",
    emptyMessage: "Experiences you favorite will appear here.",
    errorMessage: "Your favorite experiences could not be loaded.",
    invalidMessage: "Roblox returned an invalid Favorites list.",
    messageType: HOME_FAVORITES_MESSAGE,
    requiresUser: true,
    title: "Favorites",
  },
  recommended: {
    emptyMessage: "Roblox has no recommendations available.",
    errorMessage: "Recommendations could not be loaded.",
    invalidMessage: "Roblox returned invalid recommendations.",
    landscape: true,
    messageType: HOME_RECOMMENDED_MESSAGE,
    title: "Recommended For You",
  },
};

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
      <rx-home-search></rx-home-search>
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
      <rx-friends-list></rx-friends-list>
      <rx-game-feed feed="continue"></rx-game-feed>
      <rx-game-feed feed="favorites"></rx-game-feed>
      <rx-game-feed feed="recommended"></rx-game-feed>
    </div>
  </main>
`;

// Custom elements are stateful containers that own their lifecycle and requests.
class HomeApp extends HTMLElement {
  connectedCallback() {
    if (this.childElementCount) {
      document.addEventListener(ROUTE_CHANGE_EVENT, this.handleRouteChange);
      this.syncRoute();
      return;
    }

    this.handleRouteChange = () => this.syncRoute();
    this.innerHTML = homeMarkup;
    this.querySelector("[data-retry]").addEventListener("click", () =>
      loadBootstrap(this),
    );
    document.addEventListener(ROUTE_CHANGE_EVENT, this.handleRouteChange);
    this.syncRoute();
    loadBootstrap(this);
  }

  disconnectedCallback() {
    this.bootstrapRequestId = (this.bootstrapRequestId || 0) + 1;
    document.removeEventListener(ROUTE_CHANGE_EVENT, this.handleRouteChange);
  }

  syncRoute() {
    if (!isHomePath(location.pathname)) {
      this.bootstrapRequestId = (this.bootstrapRequestId || 0) + 1;
      this.hidden = true;
      document.documentElement.classList.remove("roblox-extension-home-active");
      return;
    }

    const wasHidden = this.hidden;
    this.hidden = false;
    document.documentElement.classList.add("roblox-extension-home-active");

    if (wasHidden) {
      this.dispatchEvent(new CustomEvent(HOME_REFRESH_EVENT, { bubbles: true }));
      loadBootstrap(this);
    }
  }
}

class GameFeed extends HTMLElement {
  connectedCallback() {
    if (this.content) {
      this.addUserEventListeners();
      return;
    }

    this.config = GAME_FEEDS[this.getAttribute("feed")];

    if (!this.config) {
      throw new Error("The game feed configuration is invalid.");
    }

    const feed = this.getAttribute("feed");
    const titleId = `rx-${feed}-title`;
    const headingClass = this.config.landscape
      ? "rx-section-heading"
      : "rx-section-heading rx-carousel-heading";
    const hint = this.config.landscape ? "" : "<span>Scroll to explore</span>";
    const contentClass = this.config.landscape
      ? "rx-recommended-grid"
      : "rx-game-carousel";
    const accessibility = this.config.ariaLabel
      ? ` tabindex="0" aria-label="${this.config.ariaLabel}"`
      : "";

    this.innerHTML = `
      <section class="rx-section" id="rx-${feed}" aria-labelledby="${titleId}">
        <div class="${headingClass}"><h2 id="${titleId}">${this.config.title}</h2>${hint}</div>
        <div class="${contentClass}" data-${feed}-content aria-live="polite"${accessibility}></div>
      </section>
    `;
    this.content = this.querySelector(`[data-${feed}-content]`);
    this.handleUserReady = (event) => {
      if (this.config.requiresUser) {
        this.load(event.detail.userId);
      }
    };
    this.handleUserError = () => {
      if (this.config.requiresUser) {
        this.renderBlocked();
      }
    };
    this.handleHomeRefresh = () => {
      if (this.config.requiresUser) {
        this.requestId = (this.requestId || 0) + 1;
        this.renderLoading();
      } else {
        this.load();
      }
    };
    this.addUserEventListeners();

    if (!this.config.landscape) {
      this.content.addEventListener("wheel", handleGameCarouselWheel, {
        passive: false,
      });
    }

    if (!this.config.requiresUser) {
      this.load();
    } else {
      this.renderLoading();
    }
  }

  disconnectedCallback() {
    this.requestId = (this.requestId || 0) + 1;
    document.removeEventListener(HOME_USER_READY_EVENT, this.handleUserReady);
    document.removeEventListener(HOME_USER_ERROR_EVENT, this.handleUserError);
    document.removeEventListener(HOME_REFRESH_EVENT, this.handleHomeRefresh);
  }

  addUserEventListeners() {
    document.addEventListener(HOME_USER_READY_EVENT, this.handleUserReady);
    document.addEventListener(HOME_USER_ERROR_EVENT, this.handleUserError);
    document.addEventListener(HOME_REFRESH_EVENT, this.handleHomeRefresh);
  }

  async load(userId = this.userId) {
    if (this.config.requiresUser && !Number.isSafeInteger(userId)) {
      this.renderBlocked();
      return;
    }

    this.userId = userId;
    const requestId = (this.requestId || 0) + 1;
    this.requestId = requestId;
    this.renderLoading();

    try {
      const data = await sendMessage({
        type: this.config.messageType,
        ...(this.config.requiresUser ? { userId } : {}),
      });

      if (requestId === this.requestId && this.isConnected) {
        this.renderGames(data);
      }
    } catch (error) {
      if (requestId === this.requestId && this.isConnected) {
        this.renderError(error?.message || this.config.errorMessage);
      }
    }
  }

  renderLoading() {
    const count = this.config.landscape ? 8 : 7;
    const skeletonClass = this.config.landscape
      ? "rx-game-skeleton rx-game-skeleton-landscape"
      : "rx-game-skeleton";
    this.setContentState("ready");
    this.content.replaceChildren(
      ...Array.from({ length: count }, () => {
        const skeleton = document.createElement("div");
        skeleton.className = skeletonClass;
        return skeleton;
      }),
    );
  }

  renderGames(data) {
    if (!data || !Array.isArray(data.games)) {
      throw new Error(this.config.invalidMessage);
    }

    if (!data.games.length) {
      this.renderMessage(this.config.emptyMessage);
      return;
    }

    this.setContentState("ready");
    this.content.replaceChildren(
      ...data.games.map((game) => createGameCard(game, this.config.landscape)),
    );
  }

  renderBlocked() {
    this.requestId = (this.requestId || 0) + 1;
    this.renderMessage(this.config.blockedMessage);
  }

  renderMessage(message, retry = false) {
    const state = createInlineState(message);

    if (retry) {
      state.append(createRetryButton(() => this.load()));
    }

    this.setContentState("message");
    this.content.replaceChildren(state);
  }

  renderError(message) {
    this.renderMessage(message, true);
  }

  setContentState(state) {
    if (state === "ready") {
      this.content.className = this.config.landscape
        ? "rx-recommended-grid"
        : "rx-game-carousel";
      return;
    }

    this.content.className = this.config.landscape
      ? "rx-recommended-state"
      : "rx-game-carousel-state";
  }
}

function mountHome() {
  if (
    !isHomePath(location.pathname) ||
    document.getElementById("roblox-extension-home")
  ) {
    return;
  }

  const root = document.createElement("rx-home-app");
  root.id = "roblox-extension-home";
  document.body.prepend(root);
}

function isHomePath(pathname) {
  return pathname === "/home" || pathname === "/home/";
}

function handleGameCarouselWheel(event) {
  if (event.ctrlKey) {
    return;
  }

  const carousel = event.currentTarget;
  const rawDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX)
    ? event.deltaY
    : event.deltaX;
  const multiplier =
    event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 32
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? carousel.clientWidth
        : 1;
  const delta = rawDelta * multiplier;
  const maximumScroll = carousel.scrollWidth - carousel.clientWidth;
  const canMove =
    (delta > 0 && carousel.scrollLeft < maximumScroll - 1) ||
    (delta < 0 && carousel.scrollLeft > 1);

  if (!delta) {
    return;
  }

  event.preventDefault();

  if (!canMove) {
    return;
  }

  carousel.scrollLeft += delta;
}

// create* helpers are stateless presentation functions: data in, DOM node out.
function createGameCard(game, landscape = false) {
  const card = document.createElement("a");
  const thumbnail = document.createElement("span");
  const fallback = document.createElement("span");
  const play = document.createElement("i");
  const name = document.createElement("strong");
  const stats = document.createElement("span");
  const rating = document.createElement("span");
  const players = document.createElement("span");
  const initial = Array.from(game.name.trim())[0]?.toUpperCase() || "?";

  card.className = landscape
    ? "rx-game-card rx-game-card-landscape"
    : "rx-game-card";
  card.href = `/games/${game.placeId}`;
  card.setAttribute("aria-label", `Open ${game.name}`);
  thumbnail.className = landscape
    ? "rx-game-thumbnail rx-game-thumbnail-landscape"
    : "rx-game-thumbnail";
  fallback.className = "rx-game-fallback";
  fallback.textContent = initial;
  play.className = "rx-game-play";
  name.className = "rx-game-name";
  name.textContent = game.name;
  name.title = game.name;
  stats.className = "rx-game-stats";
  rating.textContent = game.rating === null ? "-- rating" : `${game.rating}%`;
  players.textContent = `${formatCompactNumber(game.playerCount)} playing`;

  if (typeof game.imageUrl === "string" && game.imageUrl.startsWith("https://")) {
    const image = document.createElement("img");
    image.alt = "";
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    image.src = game.imageUrl;
    thumbnail.append(image, play);
  } else {
    thumbnail.append(fallback, play);
  }

  stats.append(rating, players);
  card.append(thumbnail, name, stats);
  return card;
}

function formatCompactNumber(value) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    notation: value >= 1000 ? "compact" : "standard",
  }).format(value);
}

// Stateful custom elements keep request state and clean up their own listeners.
class HomeSearch extends HTMLElement {
  connectedCallback() {
    if (this.form) {
      document.addEventListener("pointerdown", this.handleDocumentPointerDown);
      return;
    }

    this.innerHTML = `
      <form class="rx-search" action="/discover/" method="get">
        <svg class="rx-icon"><use href="#rx-search"></use></svg>
        <input name="Keyword" type="search" placeholder="Search" aria-label="Search Roblox" autocomplete="off" aria-controls="rx-search-panel" aria-expanded="false" />
        <div class="rx-search-panel" id="rx-search-panel" hidden>
          <section class="rx-search-section" aria-labelledby="rx-search-people-title">
            <span class="rx-search-section-title" id="rx-search-people-title">Players</span>
            <div class="rx-search-users" aria-live="polite"></div>
          </section>
          <section class="rx-search-section rx-search-destination-section" aria-labelledby="rx-search-destinations-title">
            <span class="rx-search-section-title" id="rx-search-destinations-title">Search in</span>
            <div class="rx-search-destinations"></div>
          </section>
        </div>
      </form>
    `;
    this.form = this.querySelector("form");
    this.input = this.querySelector("input");
    this.panel = this.querySelector(".rx-search-panel");
    this.users = this.querySelector(".rx-search-users");
    this.destinations = this.querySelector(".rx-search-destinations");
    this.handleDocumentPointerDown = (event) => {
      if (!this.contains(event.target)) {
        this.close();
      }
    };

    this.input.addEventListener("input", () => this.handleInput());
    this.input.addEventListener("focus", () => {
      if (this.input.value.trim()) {
        this.open();
      }
    });
    this.input.addEventListener("keydown", (event) => this.handleInputKey(event));
    this.panel.addEventListener("keydown", (event) => this.handlePanelKey(event));
    this.form.addEventListener("submit", (event) => {
      if (!this.input.value.trim()) {
        event.preventDefault();
      }
    });
    document.addEventListener("pointerdown", this.handleDocumentPointerDown);
  }

  disconnectedCallback() {
    clearTimeout(this.searchTimer);
    document.removeEventListener("pointerdown", this.handleDocumentPointerDown);
  }

  handleInput() {
    const query = this.input.value.trim();
    const requestId = (this.requestId || 0) + 1;
    this.requestId = requestId;
    clearTimeout(this.searchTimer);

    if (!query) {
      this.users.replaceChildren();
      this.destinations.replaceChildren();
      this.close();
      return;
    }

    this.open();
    renderHomeSearchDestinations(this.destinations, query);

    if (query.length < 3) {
      renderHomeSearchMessage(
        this.users,
        "Type at least 3 characters to find players.",
      );
      return;
    }

    renderHomeSearchMessage(this.users, "Searching players...", "loading");
    this.searchTimer = setTimeout(() => this.loadUsers(query, requestId), 250);
  }

  async loadUsers(query, requestId) {
    try {
      const data = await sendMessage({ type: HOME_USER_SEARCH_MESSAGE, query });

      if (requestId === this.requestId && this.isConnected) {
        renderHomeSearchUsers(this.users, data, query);
      }
    } catch (error) {
      if (requestId === this.requestId && this.isConnected) {
        renderHomeSearchMessage(
          this.users,
          error?.message || "Player search is temporarily unavailable.",
          "error",
        );
      }
    }
  }

  open() {
    this.panel.hidden = false;
    this.input.setAttribute("aria-expanded", "true");
  }

  close() {
    this.panel.hidden = true;
    this.input.setAttribute("aria-expanded", "false");
  }

  handleInputKey(event) {
    if (event.key === "Escape") {
      this.close();
      return;
    }

    if (event.key === "ArrowDown" && !this.panel.hidden) {
      const firstLink = this.panel.querySelector("a");

      if (firstLink) {
        event.preventDefault();
        firstLink.focus();
      }
    }
  }

  handlePanelKey(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      this.close();
      this.input.focus();
      return;
    }

    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }

    const links = [...this.panel.querySelectorAll("a")];
    const currentIndex = links.indexOf(document.activeElement);

    if (!links.length || currentIndex < 0) {
      return;
    }

    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    links[(currentIndex + direction + links.length) % links.length].focus();
  }
}

function renderHomeSearchUsers(container, data, query) {
  if (!data || !Array.isArray(data.users)) {
    throw new Error("Roblox returned invalid player search results.");
  }

  if (!data.users.length) {
    renderHomeSearchMessage(container, `No players found for “${query}”.`);
    return;
  }

  container.replaceChildren(
    ...data.users.map((user) => createHomeSearchUser(user, query)),
  );
}

// create* helpers are stateless presentation functions: data in, DOM node out.
function createHomeSearchUser(user, query) {
  const link = document.createElement("a");
  const avatar = document.createElement("span");
  const copy = document.createElement("span");
  const displayName = document.createElement("strong");
  const username = document.createElement("small");
  const normalizedQuery = query.toLocaleLowerCase();
  const previousMatch = user.previousUsernames?.find((name) =>
    name.toLocaleLowerCase().includes(normalizedQuery),
  );
  const initial = Array.from(user.displayName.trim())[0]?.toUpperCase() || "?";

  link.className = "rx-search-user";
  link.href = `/users/${user.id}/profile`;
  link.setAttribute("aria-label", `View ${user.displayName}'s profile`);
  avatar.className = "rx-search-avatar";
  avatar.textContent = initial;
  copy.className = "rx-search-user-copy";
  displayName.textContent = user.displayName;
  username.textContent = previousMatch
    ? `@${user.username} · Previously @${previousMatch}`
    : `@${user.username}`;
  setAvatarContent(avatar, user.avatarUrl, initial);
  copy.append(displayName, username);
  link.append(avatar, copy);
  return link;
}

function renderHomeSearchDestinations(container, query) {
  const encodedQuery = encodeURIComponent(query);
  const destinations = [
    ["Players", `/search/users?keyword=${encodedQuery}`],
    ["Experiences", `/discover/?Keyword=${encodedQuery}`],
    ["Communities", `/search/groups?keyword=${encodedQuery}`],
    [
      "Roblox docs",
      `https://www.google.com/search?q=${encodeURIComponent(`site:create.roblox.com/docs ${query}`)}`,
    ],
  ];

  container.replaceChildren(
    ...destinations.map(([label, href]) => {
      const link = document.createElement("a");
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
      const text = document.createElement("span");

      link.className = "rx-search-destination";
      link.href = href;
      icon.classList.add("rx-icon");
      use.setAttribute("href", "#rx-search");
      text.textContent = `${label}: “${query}”`;
      icon.append(use);
      link.append(icon, text);
      return link;
    }),
  );
}

function renderHomeSearchMessage(container, message, state = "idle") {
  const element = document.createElement("p");
  element.className = "rx-search-message";
  element.dataset.state = state;
  element.textContent = message;
  container.replaceChildren(element);
}

async function loadBootstrap(root = document.getElementById("roblox-extension-home")) {
  if (!root) {
    return;
  }

  const requestId = (root.bootstrapRequestId || 0) + 1;
  root.bootstrapRequestId = requestId;
  setBootstrapState(
    root,
    "loading",
    "Connecting to Roblox...",
    "Loading your authenticated profile and avatar.",
  );

  try {
    const data = await sendMessage({ type: HOME_BOOTSTRAP_MESSAGE });

    if (requestId !== root.bootstrapRequestId || !root.isConnected) {
      return;
    }

    renderUser(root, data?.user);
    root.dispatchEvent(
      new CustomEvent(HOME_USER_READY_EVENT, {
        bubbles: true,
        detail: { userId: data.user.id },
      }),
    );
  } catch (error) {
    if (requestId !== root.bootstrapRequestId || !root.isConnected) {
      return;
    }

    const message = error?.message || "The account could not be loaded.";
    setBootstrapState(root, "error", "We couldn't load your account", message);
    root.dispatchEvent(
      new CustomEvent(HOME_USER_ERROR_EVENT, {
        bubbles: true,
        detail: { message },
      }),
    );
  }
}

// Stateful custom elements keep request state and clean up their own listeners.
class FriendsList extends HTMLElement {
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
    document.removeEventListener(HOME_USER_READY_EVENT, this.handleUserReady);
    document.removeEventListener(HOME_USER_ERROR_EVENT, this.handleUserError);
    document.removeEventListener(HOME_REFRESH_EVENT, this.handleHomeRefresh);
  }

  addUserEventListeners() {
    document.addEventListener(HOME_USER_READY_EVENT, this.handleUserReady);
    document.addEventListener(HOME_USER_ERROR_EVENT, this.handleUserError);
    document.addEventListener(HOME_REFRESH_EVENT, this.handleHomeRefresh);
  }

  async load(userId = this.userId) {
    this.userId = userId;
    const requestId = (this.requestId || 0) + 1;
    this.requestId = requestId;
    this.renderLoading();

    try {
      const data = await sendMessage({ type: HOME_FRIENDS_MESSAGE, userId });

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
    if (!data || !Number.isSafeInteger(data.count) || !Array.isArray(data.friends)) {
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

// create* helpers are stateless presentation functions: data in, DOM node out.
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

function createRetryButton(handler) {
  const retry = document.createElement("button");
  retry.className = "rx-inline-retry";
  retry.type = "button";
  retry.textContent = "Retry";
  retry.addEventListener("click", handler, { once: true });
  return retry;
}

function createInlineState(message) {
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

const homeComponents = [
  ["rx-home-search", HomeSearch],
  ["rx-friends-list", FriendsList],
  ["rx-game-feed", GameFeed],
  ["rx-home-app", HomeApp],
];
const componentRegistry = window.customElements;

if (componentRegistry) {
  homeComponents.forEach(([name, constructor]) => {
    if (!componentRegistry.get(name)) {
      componentRegistry.define(name, constructor);
    }
  });
} else {
  // Chrome's isolated content-script world may not expose a custom element registry.
  // The MAIN-world page bridge relays lifecycle callbacks to these controllers.
  const componentControllers = new Map(homeComponents);
  const relayedComponents = new Map();

  document.addEventListener(COMPONENT_CONNECTED_EVENT, (event) => {
    let detail;

    try {
      detail = JSON.parse(event.detail);
    } catch {
      return;
    }

    const { id, name } = detail;
    const controller = componentControllers.get(name);

    if (
      !controller ||
      !(event.target instanceof HTMLElement) ||
      event.target.localName !== name
    ) {
      return;
    }

    const descriptors = Object.getOwnPropertyDescriptors(controller.prototype);
    delete descriptors.constructor;
    Object.defineProperties(event.target, descriptors);
    relayedComponents.set(id, event.target);
    event.target.connectedCallback();
  });
  document.addEventListener(COMPONENT_DISCONNECTED_EVENT, (event) => {
    let detail;

    try {
      detail = JSON.parse(event.detail);
    } catch {
      return;
    }

    const { id, name } = detail;
    const controller = componentControllers.get(name);
    const element = relayedComponents.get(id);

    if (controller?.prototype.disconnectedCallback && element) {
      controller.prototype.disconnectedCallback.call(element);
    }

    relayedComponents.delete(id);
  });
}

if (document.body) {
  mountHome();
} else {
  document.addEventListener("DOMContentLoaded", mountHome, { once: true });
}
