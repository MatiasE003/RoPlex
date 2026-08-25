import { EVENTS } from "./config.js";
import { parseRoute } from "./routes.js";

const HOME_ROOT_ID = "roblox-extension-home";
const PROFILE_ROOT_ID = "roblox-extension-profile";
const PROFILE_TOGGLE_ID = "roblox-extension-profile-mode-toggle";
const SHARED_STYLESHEET_ID = "roblox-extension-shared-styles";
const PROFILE_STYLESHEET_ID = "roblox-extension-profile-styles";

document.addEventListener(EVENTS.routeChange, reconcileRoute);
document.addEventListener("click", requestAccountSwitch);
let homeRuntimeRequest = null;
let profileRuntimeRequest = null;
let profileRedesignEnabled = true;
let profilePreferenceReady = false;
let profilePreferenceFailed = false;
let profilePreferenceRequest = null;
let profilePreferenceVersion = 0;
const stylesheetRequests = new Map();

initializeRouteController();

function initializeRouteController() {
  reconcileRoute();

  if (!document.body) {
    document.addEventListener("DOMContentLoaded", reconcileRoute, { once: true });
  }
}

function loadRouteStyles(routeName) {
  if (routeName === "home") {
    return loadStylesheet(SHARED_STYLESHEET_ID, "content.css");
  }

  if (routeName === "profile") {
    return Promise.all([
      loadStylesheet(SHARED_STYLESHEET_ID, "content.css"),
      loadStylesheet(PROFILE_STYLESHEET_ID, "profile.css"),
    ]);
  }

  return null;
}

function loadStylesheet(id, path) {
  const pendingRequest = stylesheetRequests.get(id);

  if (pendingRequest) {
    return pendingRequest;
  }

  const existingLink = document.getElementById(id);

  if (existingLink?.dataset.rxLoaded === "true") {
    return Promise.resolve();
  }

  const link = existingLink || document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = chrome.runtime.getURL(path);

  const request = new Promise((resolve, reject) => {
    link.addEventListener(
      "load",
      () => {
        link.dataset.rxLoaded = "true";
        resolve();
      },
      { once: true },
    );
    link.addEventListener(
      "error",
      () => reject(new Error(`Failed to load ${path}.`)),
      { once: true },
    );
  }).catch((error) => {
    stylesheetRequests.delete(id);
    link.remove();
    throw error;
  });

  stylesheetRequests.set(id, request);

  if (!existingLink) {
    (document.head || document.documentElement).append(link);
  }

  return request;
}

function loadHomeRuntime() {
  if (!homeRuntimeRequest) {
    homeRuntimeRequest = Promise.all([
      import("./friends.js"),
      import("./game-feed.js"),
      import("./home-app.js"),
      import("./home-search.js"),
      import("./messaging.js"),
    ])
      .then(
        ([friends, gameFeed, homeApp, homeSearch, messaging]) => {
          registerComponents([
            ["rx-home-search", homeSearch.HomeSearch],
            ["rx-friends-list", friends.FriendsList],
            ["rx-game-feed", gameFeed.GameFeed],
            ["rx-home-app", homeApp.HomeApp],
          ]);
          messaging.installHomeJoinResultListener();
          return { mount: homeApp.mountHome };
        },
      )
      .catch((error) => {
        homeRuntimeRequest = null;
        throw error;
      });
  }

  return homeRuntimeRequest;
}

function loadProfileRuntime() {
  if (!profileRuntimeRequest) {
    profileRuntimeRequest = Promise.all([
      import("./profile-app.js"),
      import("./profile-mode.js"),
    ])
      .then(([profileApp, profileMode]) => {
        registerComponents([["rx-profile-app", profileApp.ProfileApp]]);
        const runtime = {
          getPreference: profileMode.getProfileRedesignEnabled,
          mount: profileApp.mountProfile,
          mountToggle: profileMode.mountProfileModeToggle,
          removeToggle: profileMode.removeProfileModeToggle,
          updateToggle: profileMode.updateProfileModeToggle,
        };
        profileMode.watchProfileRedesignEnabled((enabled) =>
          applyProfileRedesignPreference(runtime, enabled),
        );
        return runtime;
      })
      .catch((error) => {
        profileRuntimeRequest = null;
        throw error;
      });
  }

  return profileRuntimeRequest;
}

function loadProfilePreference(runtime) {
  if (profilePreferenceRequest || profilePreferenceReady) {
    return;
  }

  const requestVersion = profilePreferenceVersion;
  profilePreferenceRequest = runtime
    .getPreference()
    .then((enabled) => {
      if (requestVersion !== profilePreferenceVersion) {
        return;
      }

      profileRedesignEnabled = enabled;
      profilePreferenceReady = true;
      profilePreferenceFailed = false;
    })
    .catch((error) => {
      if (requestVersion !== profilePreferenceVersion) {
        return;
      }

      profilePreferenceReady = true;
      profilePreferenceFailed = true;
      console.warn("Roblox Extension could not load the profile preference.", error);
    })
    .finally(() => {
      profilePreferenceRequest = null;
      reconcileRoute();
    });
}

function registerComponents(components) {
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
  const route = parseRoute(location.pathname);
  const routeStylesRequest = loadRouteStyles(route?.name);
  document.documentElement.classList.toggle(
    "roblox-extension-home-active",
    route?.name === "home",
  );
  document.documentElement.classList.remove("roblox-extension-profile-active");

  if (!document.body) {
    routeStylesRequest?.catch((error) =>
      handleRuntimeLoadFailure(route.name, error),
    );
    return;
  }

  if (route?.name === "home") {
    removeProfileUi();
    Promise.all([routeStylesRequest, loadHomeRuntime()])
      .then(([, runtime]) => {
        if (parseRoute(location.pathname)?.name === "home" && document.body) {
          runtime.mount();
        }
      })
      .catch((error) => handleRuntimeLoadFailure("home", error));
    return;
  }

  if (route?.name === "profile") {
    document.getElementById(HOME_ROOT_ID)?.remove();
    Promise.all([routeStylesRequest, loadProfileRuntime()])
      .then(([, runtime]) => reconcileProfileRoute(runtime))
      .catch((error) => handleRuntimeLoadFailure("profile", error));
    return;
  }

  document.getElementById(HOME_ROOT_ID)?.remove();
  removeProfileUi();
}

function reconcileProfileRoute(runtime) {
  if (parseRoute(location.pathname)?.name !== "profile" || !document.body) {
    return;
  }

  if (!profilePreferenceReady) {
    removeProfileUi(runtime);
    loadProfilePreference(runtime);
    return;
  }

  if (profilePreferenceFailed) {
    removeProfileUi(runtime);
    return;
  }

  runtime.mountToggle(profileRedesignEnabled, (enabled) =>
    applyProfileRedesignPreference(runtime, enabled),
  );

  if (profileRedesignEnabled) {
    runtime.mount();
    document.documentElement.classList.toggle(
      "roblox-extension-profile-active",
      Boolean(document.getElementById(PROFILE_ROOT_ID)),
    );
  } else {
    document.getElementById(PROFILE_ROOT_ID)?.remove();
  }
}

function applyProfileRedesignPreference(runtime, enabled) {
  profilePreferenceVersion += 1;
  profileRedesignEnabled = enabled;
  profilePreferenceReady = true;
  profilePreferenceFailed = false;
  runtime.updateToggle(enabled);
  reconcileRoute();
}

function removeProfileUi(runtime) {
  document.documentElement.classList.remove("roblox-extension-profile-active");
  document.getElementById(PROFILE_ROOT_ID)?.remove();

  if (runtime) {
    runtime.removeToggle();
  } else {
    document.getElementById(PROFILE_TOGGLE_ID)?.remove();
  }
}

function handleRuntimeLoadFailure(routeName, error) {
  console.error(`Roblox Extension ${routeName} frontend failed to load.`, error);

  if (parseRoute(location.pathname)?.name !== routeName) {
    return;
  }

  if (routeName === "home") {
    document.documentElement.classList.remove("roblox-extension-home-active");
    document.getElementById(HOME_ROOT_ID)?.remove();
    return;
  }

  removeProfileUi();
}

function requestAccountSwitch(event) {
  const button = event.target.closest("[data-account-switch]");

  if (!(button instanceof HTMLButtonElement)) {
    return;
  }

  button.closest("details")?.removeAttribute("open");
  document.dispatchEvent(new CustomEvent(EVENTS.accountSwitchRequest));
}
