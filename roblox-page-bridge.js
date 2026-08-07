(() => {
  const JOIN_REQUEST_EVENT = "roblox-extension:join-server";
  const JOIN_RESULT_EVENT = "roblox-extension:join-server-result";
  const ROUTE_CHANGE_EVENT = "roblox-extension:route-change";
  const COMPONENT_CONNECTED_EVENT = "roblox-extension:component-connected";
  const COMPONENT_DISCONNECTED_EVENT = "roblox-extension:component-disconnected";
  const HOME_COMPONENTS = [
    "rx-home-search",
    "rx-friends-list",
    "rx-game-feed",
    "rx-home-app",
  ];

  if (window.__robloxExtensionServerBridgeInstalled) {
    return;
  }

  window.__robloxExtensionServerBridgeInstalled = true;

  installHomeComponents();
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

  function installHomeComponents() {
    let nextComponentId = 0;

    HOME_COMPONENTS.forEach((name) => {
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
