(() => {
  const JOIN_REQUEST_EVENT = "roblox-extension:join-server";
  const JOIN_RESULT_EVENT = "roblox-extension:join-server-result";
  const ROUTE_CHANGE_EVENT = "roblox-extension:route-change";
  const COMPONENT_CONNECTED_EVENT = "roblox-extension:component-connected";
  const COMPONENT_DISCONNECTED_EVENT = "roblox-extension:component-disconnected";
  const ACCOUNT_SWITCH_REQUEST_EVENT = "roblox-extension:account-switch-request";
  const EXTENSION_COMPONENTS = [
    "rx-home-search",
    "rx-friends-list",
    "rx-game-feed",
    "rx-home-app",
    "rx-profile-app",
  ];

  if (window.__robloxExtensionServerBridgeInstalled) {
    return;
  }

  window.__robloxExtensionServerBridgeInstalled = true;

  installExtensionComponents();
  installRouteChangeBridge();

  document.addEventListener(JOIN_REQUEST_EVENT, async (event) => {
    let jobId = null;

    try {
      const detail = JSON.parse(event.detail);
      const placeId = Number(detail.placeId);
      jobId = detail.jobId;

      if (
        !Number.isSafeInteger(placeId) ||
        placeId <= 0 ||
        typeof jobId !== "string" ||
        !/^[a-zA-Z0-9-]{8,100}$/.test(jobId)
      ) {
        throw new Error("Los datos del servidor no son válidos.");
      }

      const launcher = await waitForGameLauncher();
      launcher.joinGameInstance(placeId, jobId);
      dispatchResult({ jobId, ok: true });
    } catch (error) {
      dispatchResult({
        jobId,
        message:
          error instanceof Error
            ? error.message
            : "No se pudo abrir Roblox Player.",
        ok: false,
      });
    }
  });

  document.addEventListener(ACCOUNT_SWITCH_REQUEST_EVENT, async () => {
    const nativeMenuItem = document.querySelector(".account-switch-menu-item");

    if (nativeMenuItem instanceof HTMLElement) {
      nativeMenuItem.click();
      return;
    }

    const accountSwitcher = window.Roblox?.AccountSwitcherService;

    if (
      typeof accountSwitcher?.isAccountSwitcherAvailable !== "function" ||
      typeof accountSwitcher.renderAccountSwitcher !== "function" ||
      !(await accountSwitcher.isAccountSwitcherAvailable())
    ) {
      return;
    }

    // This is Roblox's own UI and preserves the browser's linked accounts.
    accountSwitcher.renderAccountSwitcher({
      containerId: "navigation-account-switcher-container",
      handleAddAccount: () => {
        location.assign("/newlogin?ReturnUrl=%2Fhome");
      },
      onAccountSwitched: () => {
        location.assign("/home");
      },
    });
  });

  function waitForGameLauncher() {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const timer = setInterval(() => {
        const launcher = window.Roblox?.GameLauncher;

        if (typeof launcher?.joinGameInstance === "function") {
          clearInterval(timer);
          resolve(launcher);
          return;
        }

        if (Date.now() - startedAt >= 5000) {
          clearInterval(timer);
          reject(
            new Error(
              "El launcher oficial de Roblox todavía no está disponible. Recargá la página e intentá de nuevo.",
            ),
          );
        }
      }, 100);
    });
  }

  function installExtensionComponents() {
    let nextComponentId = 0;

    EXTENSION_COMPONENTS.forEach((name) => {
      if (customElements.get(name)) {
        return;
      }

      customElements.define(
        name,
        class extends HTMLElement {
          connectedCallback() {
            this.dataset.rxComponentId ||= String(++nextComponentId);
            this.dispatchEvent(
              new CustomEvent(COMPONENT_CONNECTED_EVENT, {
                bubbles: true,
                detail: JSON.stringify({
                  id: this.dataset.rxComponentId,
                  name,
                }),
              }),
            );
          }

          disconnectedCallback() {
            document.dispatchEvent(
              new CustomEvent(COMPONENT_DISCONNECTED_EVENT, {
                detail: JSON.stringify({
                  id: this.dataset.rxComponentId,
                  name,
                }),
              }),
            );
          }
        },
      );
    });
  }

  function installRouteChangeBridge() {
    let previousPathname = location.pathname;
    const dispatchRouteChange = () => {
      const pathname = location.pathname;

      if (pathname === previousPathname) {
        return;
      }

      previousPathname = pathname;
      document.dispatchEvent(
        new CustomEvent(ROUTE_CHANGE_EVENT, {
          detail: pathname,
        }),
      );
    };

    ["pushState", "replaceState"].forEach((method) => {
      const original = history[method];
      history[method] = function (...args) {
        const result = original.apply(this, args);
        dispatchRouteChange();
        return result;
      };
    });
    window.addEventListener("popstate", dispatchRouteChange);
  }

  function dispatchResult(detail) {
    document.dispatchEvent(
      new CustomEvent(JOIN_RESULT_EVENT, {
        detail: JSON.stringify(detail),
      }),
    );
  }
})();
