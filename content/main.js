import { EVENTS } from "./config.js";
import { FriendsList } from "./friends.js";
import { GameFeed } from "./game-feed.js";
import { HomeApp, mountHome } from "./home-app.js";
import { HomeSearch } from "./home-search.js";
import { installHomeJoinResultListener } from "./messaging.js";
import { ProfileApp, mountProfile } from "./profile-app.js";
import {
  getProfileRedesignEnabled,
  mountProfileModeToggle,
  removeProfileModeToggle,
  updateProfileModeToggle,
  watchProfileRedesignEnabled,
} from "./profile-mode.js";
import { parseRoute } from "./routes.js";

const components = [
  ["rx-home-search", HomeSearch],
  ["rx-friends-list", FriendsList],
  ["rx-game-feed", GameFeed],
  ["rx-home-app", HomeApp],
  ["rx-profile-app", ProfileApp],
];

installHomeJoinResultListener();
registerComponents();
document.addEventListener(EVENTS.routeChange, reconcileRoute);
let profileRedesignEnabled = true;
let profilePreferenceReady = false;

initializeRouteController();

async function initializeRouteController() {
  try {
    profileRedesignEnabled = await getProfileRedesignEnabled();
  } catch (error) {
    console.warn("Roblox Extension could not load the profile preference.", error);
  }

  profilePreferenceReady = true;
  watchProfileRedesignEnabled(applyProfileRedesignPreference);

  if (document.body) {
    reconcileRoute();
  } else {
    document.addEventListener("DOMContentLoaded", reconcileRoute, { once: true });
  }
}

function registerComponents() {
  const componentRegistry = window.customElements;

  if (componentRegistry) {
    components.forEach(([name, constructor]) => {
      if (!componentRegistry.get(name)) {
        componentRegistry.define(name, constructor);
      }
    });
    return;
  }

  // Chrome's isolated content-script world may not expose a custom element registry.
  // The MAIN-world page bridge relays lifecycle callbacks to these controllers.
  const componentControllers = new Map(components);
  const relayedComponents = new Map();

  document.addEventListener(EVENTS.componentConnected, (event) => {
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
  document.addEventListener(EVENTS.componentDisconnected, (event) => {
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

function reconcileRoute() {
  if (!profilePreferenceReady) {
    return;
  }

  const route = parseRoute(location.pathname);
  document.documentElement.classList.toggle(
    "roblox-extension-home-active",
    route?.name === "home",
  );
  document.documentElement.classList.toggle(
    "roblox-extension-profile-active",
    route?.name === "profile" && profileRedesignEnabled,
  );

  if (!document.body) return;

  if (route?.name === "home") {
    removeProfileModeToggle();
    document.getElementById("roblox-extension-profile")?.remove();
    mountHome();
    return;
  }

  if (route?.name === "profile") {
    document.getElementById("roblox-extension-home")?.remove();
    mountProfileModeToggle(
      profileRedesignEnabled,
      applyProfileRedesignPreference,
    );

    if (profileRedesignEnabled) {
      mountProfile();
    } else {
      document.getElementById("roblox-extension-profile")?.remove();
    }
    return;
  }

  removeProfileModeToggle();
  document.getElementById("roblox-extension-home")?.remove();
  document.getElementById("roblox-extension-profile")?.remove();
}

function applyProfileRedesignPreference(enabled) {
  profileRedesignEnabled = enabled;
  updateProfileModeToggle(enabled);
  reconcileRoute();
}
