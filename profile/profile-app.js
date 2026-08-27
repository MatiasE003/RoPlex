import {
  createAppShellMarkup,
  renderShellAuthenticatedUser,
  renderShellSignedOut,
} from "../shared/app-shell.js";
import { EVENTS, MESSAGE_TYPES } from "../shared/config.js";
import { sendMessage } from "../shared/messaging.js";
import {
  renderProfileAvatar,
  renderProfileBadges,
  renderProfileBootstrap,
  renderProfileCommunities,
  renderProfileCreations,
  renderProfileFavorites,
  renderProfileFriends,
  renderProfileSectionState,
} from "./profile-sections.js";
import { getProfileRoute } from "../shared/routes.js";

const profileMarkup = createAppShellMarkup({
  active: "profile",
  main: `
    <div class="rx-profile-shell">
      <div data-profile-section="bootstrap"></div>
      <nav class="rx-profile-tabs" aria-label="Profile sections">
        <a href="#profile-account">About</a><a href="#profile-avatar">Avatar</a><a href="#profile-creations">Creations</a><a href="#profile-favorites">Favorites</a><a href="#profile-friends">Friends</a><a href="#profile-communities">Communities</a><a href="#profile-badges">Badges</a>
      </nav>
      <div class="rx-profile-flow">
        <div id="profile-avatar" data-profile-section="avatar"></div>
        <div id="profile-account" data-profile-section="account"></div>
        <div id="profile-creations" data-profile-section="creations"></div>
        <div id="profile-favorites" data-profile-section="favorites"></div>
        <div id="profile-friends" data-profile-section="friends"></div>
        <div id="profile-communities" data-profile-section="communities"></div>
        <div id="profile-badges" data-profile-section="badges"></div>
      </div>
    </div>
  `,
});

const sectionLoaders = {
  avatar: {
    idle: "Avatar loads as it approaches the viewport.",
    loading: "Loading current avatar...",
    messageType: MESSAGE_TYPES.profileAvatar,
    render: renderProfileAvatar,
  },
  creations: {
    idle: "Creations load as they approach the viewport.",
    loading: "Loading creations...",
    messageType: MESSAGE_TYPES.profileCreations,
    render: renderProfileCreations,
  },
  favorites: {
    idle: "Favorites load as they approach the viewport.",
    loading: "Loading favorites...",
    messageType: MESSAGE_TYPES.profileFavorites,
    render: renderProfileFavorites,
  },
  friends: {
    idle: "Friends load as they approach the viewport.",
    loading: "Loading friends...",
    messageType: MESSAGE_TYPES.profileFriends,
    render: renderProfileFriends,
  },
  communities: {
    idle: "Communities load as they approach the viewport.",
    loading: "Loading communities...",
    messageType: MESSAGE_TYPES.profileCommunities,
    render: renderProfileCommunities,
  },
  badges: {
    idle: "Badges load as they approach the viewport.",
    loading: "Loading badges...",
    messageType: MESSAGE_TYPES.profileBadges,
    render: renderProfileBadges,
  },
};

const sectionByHash = new Map([
  ["#profile-account", "account"],
  ["#profile-avatar", "avatar"],
  ["#profile-creations", "creations"],
  ["#profile-favorites", "favorites"],
  ["#profile-friends", "friends"],
  ["#profile-communities", "communities"],
  ["#profile-badges", "badges"],
]);

export class ProfileApp extends HTMLElement {
  connectedCallback() {
    if (!this.childElementCount) {
      this.innerHTML = profileMarkup;
      this.handleRouteChange = () => this.syncRoute();
      this.handleHashChange = () => this.loadHashSection();
      this.handleTabClick = (event) => {
        const link = event.target.closest("a[href^='#profile-']");

        if (link && this.contains(link)) {
          this.loadHashSection(link.hash);
        }
      };
    }

    document.addEventListener(EVENTS.routeChange, this.handleRouteChange);
    window.addEventListener("hashchange", this.handleHashChange);
    this.addEventListener("click", this.handleTabClick);
    this.syncRoute();
  }

  disconnectedCallback() {
    this.requestGeneration = (this.requestGeneration || 0) + 1;
    this.disconnectSectionObserver();
    document.removeEventListener(EVENTS.routeChange, this.handleRouteChange);
    window.removeEventListener("hashchange", this.handleHashChange);
    this.removeEventListener("click", this.handleTabClick);
    document.documentElement.classList.remove("roblox-extension-profile-active");
  }

  syncRoute() {
    const route = getProfileRoute(location.pathname);

    if (!route) {
      this.requestGeneration = (this.requestGeneration || 0) + 1;
      this.disconnectSectionObserver();
      this.activeUserId = null;
      this.hidden = true;
      document.documentElement.classList.remove("roblox-extension-profile-active");
      return;
    }

    this.hidden = false;
    document.documentElement.classList.add("roblox-extension-profile-active");

    if (this.activeUserId !== route.userId) {
      this.activeUserId = route.userId;
      this.loadProfile(route.userId);
    }
  }

  loadProfile(userId) {
    const generation = (this.requestGeneration || 0) + 1;
    this.requestGeneration = generation;
    this.disconnectSectionObserver();
    this.sectionStates = new Map();
    renderShellSignedOut(this);
    this.dispatchEvent(
      new CustomEvent(EVENTS.profileRefresh, {
        bubbles: true,
        detail: { userId },
      }),
    );
    this.loadBootstrap(userId, generation);
    this.observeSections(userId, generation);
    this.loadSection("avatar", userId, generation);
    this.loadHashSection();
  }

  async loadBootstrap(userId, generation) {
    const container = this.section("bootstrap");
    const accountContainer = this.section("account");
    renderProfileSectionState(container, "Loading profile...");
    renderProfileSectionState(accountContainer, "Loading account information...");

    try {
      const data = await sendMessage({
        type: MESSAGE_TYPES.profileBootstrap,
        userId,
      });

      if (!this.isCurrent(userId, generation)) return;
      const { viewer } = renderProfileBootstrap(container, data, {
        accountContainer,
        onFollow: () =>
          sendMessage({ type: MESSAGE_TYPES.profileFollow, userId }),
        onFriend: () =>
          sendMessage({ type: MESSAGE_TYPES.profileFriendRequest, userId }),
        userId,
      });
      if (viewer) {
        renderShellAuthenticatedUser(this, viewer);
      }
    } catch (error) {
      if (!this.isCurrent(userId, generation)) return;
      const message = error?.message || "This profile could not be loaded.";
      renderProfileSectionState(
        container,
        message,
        () => this.loadBootstrap(userId, generation),
      );
      renderProfileSectionState(accountContainer, message);
    }
  }

  loadSection(section, userId, generation) {
    const existing = this.sectionStates?.get(section);

    if (existing?.status === "loading" || existing?.status === "loaded") {
      return existing.promise;
    }

    this.sectionObserver?.unobserve(this.section(section));
    const promise = this.performSectionLoad(section, userId, generation);
    this.sectionStates?.set(section, { promise, status: "loading" });
    return promise;
  }

  async performSectionLoad(section, userId, generation) {
    const config = sectionLoaders[section];
    const container = this.section(section);
    container.dataset.profileLoadState = "loading";
    renderProfileSectionState(container, config.loading);

    try {
      const data = await sendMessage({ type: config.messageType, userId });
      if (!this.isCurrent(userId, generation)) return;
      await config.render(container, data, userId, {
        isCurrent: () => this.isCurrent(userId, generation),
      });
      if (!this.isCurrent(userId, generation)) return;
      container.dataset.profileLoadState = "loaded";
      this.sectionStates?.set(section, {
        promise: Promise.resolve(),
        status: "loaded",
      });

      if (sectionByHash.get(location.hash) === section) {
        container.scrollIntoView({ block: "start" });
      }
    } catch (error) {
      if (!this.isCurrent(userId, generation)) return;
      container.dataset.profileLoadState = "error";
      this.sectionStates?.set(section, { promise: null, status: "error" });
      renderProfileSectionState(
        container,
        error?.message || `The ${section} section could not be loaded.`,
        () => this.loadSection(section, userId, generation),
      );
    }
  }

  observeSections(userId, generation) {
    for (const [section, config] of Object.entries(sectionLoaders)) {
      const container = this.section(section);
      container.dataset.profileLoadState = "idle";
      renderProfileSectionState(container, config.idle);
      this.sectionStates.set(section, { promise: null, status: "idle" });
    }

    if (typeof IntersectionObserver !== "function") {
      Object.keys(sectionLoaders).forEach((section) =>
        this.loadSection(section, userId, generation),
      );
      return;
    }

    this.sectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const section = entry.target.dataset.profileSection;
          if (sectionLoaders[section]) {
            this.loadSection(section, userId, generation);
          }
        });
      },
      { rootMargin: "360px 0px" },
    );

    Object.keys(sectionLoaders).forEach((section) =>
      this.sectionObserver.observe(this.section(section)),
    );
  }

  loadHashSection(hash = location.hash) {
    const section = sectionByHash.get(hash);

    if (!section || !this.activeUserId || !this.sectionStates) return;
    const container = this.section(section);
    container.scrollIntoView({ block: "start" });
    if (!sectionLoaders[section]) return;
    this.loadSection(section, this.activeUserId, this.requestGeneration);
  }

  disconnectSectionObserver() {
    this.sectionObserver?.disconnect();
    this.sectionObserver = null;
  }

  isCurrent(userId, generation) {
    return (
      this.isConnected &&
      !this.hidden &&
      this.activeUserId === userId &&
      this.requestGeneration === generation
    );
  }

  section(name) {
    return this.querySelector(`[data-profile-section="${name}"]`);
  }
}

export function mountProfile() {
  if (
    !getProfileRoute(location.pathname) ||
    document.getElementById("roblox-extension-profile")
  ) {
    return;
  }

  const root = document.createElement("rx-profile-app");
  root.id = "roblox-extension-profile";
  document.body.prepend(root);
}
