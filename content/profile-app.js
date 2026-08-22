import {
  createAppShellMarkup,
  renderShellAuthenticatedUser,
  renderShellSignedOut,
} from "./app-shell.js";
import { EVENTS, MESSAGE_TYPES } from "./config.js";
import { sendMessage } from "./messaging.js";
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
import { getProfileRoute } from "./routes.js";

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
    loading: "Loading current avatar...",
    messageType: MESSAGE_TYPES.profileAvatar,
    render: renderProfileAvatar,
  },
  badges: {
    loading: "Loading badges...",
    messageType: MESSAGE_TYPES.profileBadges,
    render: renderProfileBadges,
  },
  communities: {
    loading: "Loading communities...",
    messageType: MESSAGE_TYPES.profileCommunities,
    render: renderProfileCommunities,
  },
  creations: {
    loading: "Loading creations...",
    messageType: MESSAGE_TYPES.profileCreations,
    render: renderProfileCreations,
  },
  favorites: {
    loading: "Loading favorites...",
    messageType: MESSAGE_TYPES.profileFavorites,
    render: renderProfileFavorites,
  },
  friends: {
    loading: "Loading friends...",
    messageType: MESSAGE_TYPES.profileFriends,
    render: renderProfileFriends,
  },
};

export class ProfileApp extends HTMLElement {
  connectedCallback() {
    if (!this.childElementCount) {
      this.innerHTML = profileMarkup;
      this.handleRouteChange = () => this.syncRoute();
    }

    document.addEventListener(EVENTS.routeChange, this.handleRouteChange);
    this.syncRoute();
  }

  disconnectedCallback() {
    this.requestGeneration = (this.requestGeneration || 0) + 1;
    document.removeEventListener(EVENTS.routeChange, this.handleRouteChange);
    document.documentElement.classList.remove("roblox-extension-profile-active");
  }

  syncRoute() {
    const route = getProfileRoute(location.pathname);

    if (!route) {
      this.requestGeneration = (this.requestGeneration || 0) + 1;
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
    renderShellSignedOut(this);
    this.dispatchEvent(
      new CustomEvent(EVENTS.profileRefresh, {
        bubbles: true,
        detail: { userId },
      }),
    );
    this.loadBootstrap(userId, generation);
    Object.keys(sectionLoaders).forEach((section) =>
      this.loadSection(section, userId, generation),
    );
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

  async loadSection(section, userId, generation) {
    const config = sectionLoaders[section];
    const container = this.section(section);
    renderProfileSectionState(container, config.loading);

    try {
      const data = await sendMessage({ type: config.messageType, userId });
      if (!this.isCurrent(userId, generation)) return;
      config.render(container, data, userId);
    } catch (error) {
      if (!this.isCurrent(userId, generation)) return;
      renderProfileSectionState(
        container,
        error?.message || `The ${section} section could not be loaded.`,
        () => this.loadSection(section, userId, generation),
      );
    }
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
