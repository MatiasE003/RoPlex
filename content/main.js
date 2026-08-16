import { EVENTS } from "./config.js";
import { FriendsList } from "./friends.js";
import { GameFeed } from "./game-feed.js";
import { HomeApp, mountHome } from "./home-app.js";
import { HomeSearch } from "./home-search.js";
import { installHomeJoinResultListener } from "./messaging.js";

const homeComponents = [
  ["rx-home-search", HomeSearch],
  ["rx-friends-list", FriendsList],
  ["rx-game-feed", GameFeed],
  ["rx-home-app", HomeApp],
];

installHomeJoinResultListener();
registerHomeComponents();

if (document.body) {
  mountHome();
} else {
  document.addEventListener("DOMContentLoaded", mountHome, { once: true });
}

function registerHomeComponents() {
  const componentRegistry = window.customElements;

  if (componentRegistry) {
    homeComponents.forEach(([name, constructor]) => {
      if (!componentRegistry.get(name)) {
        componentRegistry.define(name, constructor);
      }
    });
    return;
  }

  // Chrome's isolated content-script world may not expose a custom element registry.
  // The MAIN-world page bridge relays lifecycle callbacks to these controllers.
  const componentControllers = new Map(homeComponents);
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
