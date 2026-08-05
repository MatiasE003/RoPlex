(() => {
  const JOIN_REQUEST_EVENT = "roblox-extension:join-server";
  const JOIN_RESULT_EVENT = "roblox-extension:join-server-result";

  if (window.__robloxExtensionServerBridgeInstalled) {
    return;
  }

  window.__robloxExtensionServerBridgeInstalled = true;

  document.addEventListener(JOIN_REQUEST_EVENT, async (event) => {
    try {
      const detail = JSON.parse(event.detail);
      const placeId = Number(detail.placeId);
      const jobId = detail.jobId;

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

  function dispatchResult(detail) {
    document.dispatchEvent(
      new CustomEvent(JOIN_RESULT_EVENT, {
        detail: JSON.stringify(detail),
      }),
    );
  }
})();
