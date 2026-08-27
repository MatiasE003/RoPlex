import {
  createAppShellMarkup,
  renderShellAuthenticatedUser,
} from "../shared/app-shell.js";
import { EVENTS, MESSAGE_TYPES } from "../shared/config.js";
import { sendMessage } from "../shared/messaging.js";
import { isHomeRoute } from "../shared/routes.js";

const homeMarkup = createAppShellMarkup({
  active: "home",
  loadingAccount: true,
  main: `
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
  `,
});

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
    if (!isHomeRoute(location.pathname)) {
      this.bootstrapRequestId = (this.bootstrapRequestId || 0) + 1;
      this.hidden = true;
      document.documentElement.classList.remove("roblox-extension-home-active");
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
    !isHomeRoute(location.pathname) ||
    document.getElementById("roblox-extension-home")
  ) {
    return;
  }

  const root = document.createElement("rx-home-app");
  root.id = "roblox-extension-home";
  document.body.prepend(root);
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
  renderShellAuthenticatedUser(root, user);
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
