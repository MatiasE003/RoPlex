import { EVENTS, MESSAGE_TYPES } from "./config.js";
import { sendMessage } from "./messaging.js";

const icons = `
  <svg class="rx-icon-defs" aria-hidden="true">
    <symbol id="rx-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></symbol>
    <symbol id="rx-home" viewBox="0 0 24 24"><path d="m3 11 9-8 9 8"></path><path d="M5 10v10h14V10M9 20v-6h6v6"></path></symbol>
    <symbol id="rx-user" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"></circle><path d="M4 21a8 8 0 0 1 16 0"></path></symbol>
    <symbol id="rx-users" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"></path></symbol>
    <symbol id="rx-avatar" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"></circle><path d="M7 14h10l2 7H5l2-7Z"></path></symbol>
    <symbol id="rx-box" viewBox="0 0 24 24"><path d="m4 7 8-4 8 4-8 4-8-4Z"></path><path d="M4 7v10l8 4 8-4V7M12 11v10"></path></symbol>
    <symbol id="rx-message" viewBox="0 0 24 24"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"></path></symbol>
    <symbol id="rx-more" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle></symbol>
    <symbol id="rx-bell" viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"></path></symbol>
    <symbol id="rx-robux" viewBox="0 0 24 24"><path d="m12 2.5 9.5 9.5-9.5 9.5L2.5 12 12 2.5Z"></path><path d="m12 8.5 3.5 3.5-3.5 3.5L8.5 12 12 8.5Z"></path></symbol>
    <symbol id="rx-gear" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"></circle><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1A7 7 0 0 0 15 6l-.3-2.6h-4L10.4 6A7 7 0 0 0 9 7L6.5 6l-2 3.4 2 1.5a7 7 0 0 0 0 2L4.5 14l2 3.4L9 17a7 7 0 0 0 1.5.9l.3 2.6h4l.3-2.6a7 7 0 0 0 1.5-.9l2.4.5 2-3.4-2-1.2a7 7 0 0 0 .1-1Z"></path></symbol>
    <symbol id="rx-premium" viewBox="0 0 24 24"><path d="m12 3 3 6 6 .8-4.5 4.5 1.1 6.2L12 17.6l-5.6 2.9 1.1-6.2L3 9.8 9 9l3-6Z"></path></symbol>
    <symbol id="rx-refresh" viewBox="0 0 24 24"><path d="M20 7v5h-5M4 17v-5h5"></path><path d="M18.5 9A7 7 0 0 0 6 6.5L4 9M5.5 15A7 7 0 0 0 18 17.5l2-2.5"></path></symbol>
  </svg>
`;

const homeMarkup = `
  ${icons}
  <header class="rx-topbar">
    <a class="rx-brand" href="/home" aria-label="Roblox Home"><i class="rx-brand-mark"></i><span>ROBLOX</span></a>
    <nav class="rx-primary-nav" aria-label="Roblox sections"><a class="active" href="/home">Home</a><a href="/charts">Charts</a><a href="/catalog">Marketplace</a><a href="/create">Create</a></nav>
    <div class="rx-topbar-tools">
      <rx-home-search></rx-home-search>
      <a class="rx-top-icon" href="/notifications" aria-label="Notifications"><svg class="rx-icon"><use href="#rx-bell"></use></svg></a>
      <a class="rx-top-icon rx-robux-balance" href="/upgrades/robux" aria-label="Robux balance"><svg class="rx-icon"><use href="#rx-robux"></use></svg><span data-user-robux>--</span></a>
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

// The root component coordinates route visibility and account bootstrap state.
export class HomeApp extends HTMLElement {
  connectedCallback() {
    if (this.childElementCount) {
      document.addEventListener(EVENTS.routeChange, this.handleRouteChange);
      this.syncRoute();
      return;
    }

    this.handleRouteChange = () => this.syncRoute();
    this.innerHTML = homeMarkup;
    this.querySelector("[data-retry]").addEventListener("click", () =>
      loadBootstrap(this),
    );
    document.addEventListener(EVENTS.routeChange, this.handleRouteChange);
    this.syncRoute();
    loadBootstrap(this);
  }

  disconnectedCallback() {
    this.bootstrapRequestId = (this.bootstrapRequestId || 0) + 1;
    document.removeEventListener(EVENTS.routeChange, this.handleRouteChange);
  }

  syncRoute() {
    if (!isHomePath(location.pathname)) {
      this.bootstrapRequestId = (this.bootstrapRequestId || 0) + 1;
      this.hidden = true;
      document.documentElement.classList.remove(
        "roblox-extension-home-active",
      );
      return;
    }

    const wasHidden = this.hidden;
    this.hidden = false;
    document.documentElement.classList.add("roblox-extension-home-active");

    if (wasHidden) {
      this.dispatchEvent(
        new CustomEvent(EVENTS.homeRefresh, { bubbles: true }),
      );
      loadBootstrap(this);
    }
  }
}

export function mountHome() {
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

async function loadBootstrap(
  root = document.getElementById("roblox-extension-home"),
) {
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
    const data = await sendMessage({ type: MESSAGE_TYPES.bootstrap });

    if (requestId !== root.bootstrapRequestId || !root.isConnected) {
      return;
    }

    renderUser(root, data?.user);
    root.dispatchEvent(
      new CustomEvent(EVENTS.userReady, {
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
      new CustomEvent(EVENTS.userError, {
        bubbles: true,
        detail: { message },
      }),
    );
  }
}

function renderUser(root, user) {
  if (
    !user ||
    !Number.isSafeInteger(user.id) ||
    !user.displayName ||
    !user.username
  ) {
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
  root.querySelectorAll("[data-user-robux]").forEach((element) => {
    const balance =
      Number.isSafeInteger(user.robux) && user.robux >= 0
        ? new Intl.NumberFormat("en-US").format(user.robux)
        : "--";
    element.textContent = balance;
    element
      .closest("a")
      ?.setAttribute("aria-label", `Robux balance: ${balance}`);
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

  if (
    typeof user.avatarUrl === "string" &&
    user.avatarUrl.startsWith("https://")
  ) {
    root.querySelectorAll("[data-user-avatar]").forEach((element) => {
      const image = document.createElement("img");
      image.alt = "";
      image.referrerPolicy = "no-referrer";
      image.src = user.avatarUrl;
      element.replaceChildren(image);
    });
  }

  setBootstrapState(
    root,
    "ready",
    `Welcome back, ${user.displayName}`,
    `Signed in as @${user.username}. Your Home shell is connected to Roblox.`,
  );
}

function setBootstrapState(root, state, heading, status) {
  const card = root.querySelector(".rx-bootstrap-card");
  card.dataset.state = state;
  root.querySelector("[data-greeting]").textContent = heading;
  root.querySelector("[data-bootstrap-status]").textContent = status;
  root.querySelector("[data-retry]").hidden = state !== "error";
}
