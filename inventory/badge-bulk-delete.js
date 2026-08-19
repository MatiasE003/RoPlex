(() => {
  const ROOT_ID = "roblox-extension-badge-bulk-delete";
  const CARD_SELECTOR = "#assetsItems > li";
  const BATCH_SIZE = 1;
  const DELETE_INTERVAL_MS = 200;

  let contextGeneration = 0;
  let contextUserId = null;
  let deletionGeneration = 0;
  let isOwnInventory = false;
  let mountScheduled = false;
  let selectionMode = false;
  let deleting = false;
  const selectedBadgeIds = new Set();

  const observer = new MutationObserver(scheduleReconcile);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener("hashchange", handleRouteChange);
  window.addEventListener("popstate", handleRouteChange);
  document.addEventListener("click", handleDocumentClick, true);
  scheduleReconcile();

  function handleRouteChange() {
    if (
      !isBadgeInventoryRoute() ||
      (contextUserId && getInventoryUserId() !== contextUserId)
    ) {
      contextGeneration += 1;
      contextUserId = null;
      isOwnInventory = false;
      stopSelection();
    }

    scheduleReconcile();
  }

  function scheduleReconcile() {
    if (mountScheduled) {
      return;
    }

    mountScheduled = true;
    requestAnimationFrame(() => {
      mountScheduled = false;
      reconcile();
    });
  }

  function reconcile() {
    const pageUserId = getInventoryUserId();

    if (!pageUserId || !isBadgeInventoryRoute()) {
      removeRoot();
      return;
    }

    if (contextUserId !== pageUserId) {
      stopSelection();
      loadInventoryContext(pageUserId);
      return;
    }

    if (!isOwnInventory) {
      removeRoot();
      return;
    }

    mountControls();
    decorateCards();
  }

  async function loadInventoryContext(pageUserId, retryCount = 0) {
    const generation = ++contextGeneration;
    contextUserId = pageUserId;
    isOwnInventory = false;
    removeRoot();

    try {
      const context = await sendMessage({ type: "GET_BADGE_INVENTORY_CONTEXT" });

      if (generation !== contextGeneration || getInventoryUserId() !== pageUserId) {
        return;
      }

      isOwnInventory = context?.isOwnInventory === true;
      scheduleReconcile();
    } catch {
      // The destructive controls stay hidden when ownership cannot be verified.
      if (retryCount < 2) {
        setTimeout(() => {
          if (
            generation === contextGeneration &&
            getInventoryUserId() === pageUserId &&
            isBadgeInventoryRoute()
          ) {
            loadInventoryContext(pageUserId, retryCount + 1);
          }
        }, 1500 * (retryCount + 1));
      }
    }
  }

  function mountControls() {
    const page = document.querySelector("#inventory-container .row.page-content");

    if (!page) {
      return;
    }

    page.classList.add("roblox-extension-badge-page");

    let root = document.getElementById(ROOT_ID);

    if (!root) {
      root = document.createElement("div");
      root.id = ROOT_ID;
      root.className = "roblox-extension-badge-bulk-delete";
      root.addEventListener("click", handleControlClick);
      page.prepend(root);
      renderControls();
    }
  }

  function renderControls(message = "", tone = "") {
    const root = document.getElementById(ROOT_ID);

    if (!root) {
      return;
    }

    if (!selectionMode) {
      root.innerHTML = `
        <button class="roblox-extension-badge-button" data-action="start" type="button">
          Bulk delete
        </button>
      `;
      return;
    }

    const count = selectedBadgeIds.size;
    const statusText = message || `${count} insignia${count === 1 ? "" : "s"} seleccionada${count === 1 ? "" : "s"}. La eliminación es permanente.`;
    root.innerHTML = `
      <span class="roblox-extension-badge-status${tone ? ` is-${tone}` : ""}" role="status" aria-live="polite">
        ${escapeHtml(statusText)}
      </span>
      <button class="roblox-extension-badge-button is-secondary" data-action="cancel" type="button" ${deleting ? "disabled" : ""}>
        Cancelar
      </button>
      <button class="roblox-extension-badge-button is-danger" data-action="delete" type="button" ${!count || deleting ? "disabled" : ""}>
        ${deleting ? "Eliminando..." : `Confirmar eliminación (${count})`}
      </button>
    `;
  }

  function handleControlClick(event) {
    const action = event.target.closest("button")?.dataset.action;

    if (action === "start") {
      selectionMode = true;
      renderControls();
      decorateCards();
      return;
    }

    if (action === "cancel" && !deleting) {
      stopSelection();
      return;
    }

    if (action === "delete" && !deleting && selectedBadgeIds.size) {
      deleteSelectedBadges();
    }
  }

  function handleDocumentClick(event) {
    if (
      !selectionMode ||
      deleting ||
      !isOwnInventory ||
      !isBadgeInventoryRoute() ||
      getInventoryUserId() !== contextUserId
    ) {
      return;
    }

    const card = event.target.closest(CARD_SELECTOR);
    const badgeId = getBadgeIdFromCard(card);

    if (!badgeId) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    if (selectedBadgeIds.has(badgeId)) {
      selectedBadgeIds.delete(badgeId);
    } else {
      selectedBadgeIds.add(badgeId);
    }

    updateCardSelection(card, badgeId);
    renderControls();
  }

  function decorateCards() {
    if (!selectionMode) {
      return;
    }

    document.querySelectorAll(CARD_SELECTOR).forEach((card) => {
      const badgeId = getBadgeIdFromCard(card);

      if (!badgeId) {
        return;
      }

      card.classList.add("roblox-extension-badge-selectable");
      card.dataset.robloxExtensionBadgeId = String(badgeId);
      updateCardSelection(card, badgeId);

      if (!card.querySelector(".roblox-extension-badge-check")) {
        const check = document.createElement("span");
        check.className = "roblox-extension-badge-check";
        check.setAttribute("aria-hidden", "true");
        check.textContent = "✓";
        card.querySelector(".item-card-container")?.append(check);
      }
    });
  }

  function updateCardSelection(card, badgeId) {
    const selected = selectedBadgeIds.has(badgeId);
    card.classList.toggle("is-selected", selected);
    card.setAttribute("aria-selected", String(selected));
  }

  async function deleteSelectedBadges() {
    const generation = ++deletionGeneration;
    const badgeIds = [...selectedBadgeIds];
    const deletedBadgeIds = [];
    const failures = [];
    deleting = true;
    renderControls(`Preparando la eliminación de ${badgeIds.length} insignias...`);

    for (let index = 0; index < badgeIds.length; index += BATCH_SIZE) {
      if (
        generation !== deletionGeneration ||
        !isOwnInventory ||
        !isBadgeInventoryRoute() ||
        getInventoryUserId() !== contextUserId ||
        !selectedBadgeIds.has(badgeIds[index])
      ) {
        return;
      }

      const batch = badgeIds.slice(index, index + BATCH_SIZE);
      renderControls(
        `Eliminando insignias ${index + 1}-${Math.min(index + batch.length, badgeIds.length)} de ${badgeIds.length}...`,
      );

      try {
        const result = await sendMessage({
          badgeIds: batch,
          type: "DELETE_INVENTORY_BADGES",
        });

        if (generation !== deletionGeneration) {
          return;
        }

        deletedBadgeIds.push(...(result?.deletedBadgeIds ?? []));
        const batchFailures = result?.failures ?? [];
        failures.push(...batchFailures);

        const blockingFailure = batchFailures.find(
          ({ error }) => error?.code !== "BADGE_DELETE_FAILED",
        );

        if (blockingFailure) {
          failures.push(
            ...badgeIds.slice(index + batch.length).map((badgeId) => ({
              badgeId,
              error: blockingFailure.error,
            })),
          );
          break;
        }
      } catch (error) {
        if (generation !== deletionGeneration) {
          return;
        }

        failures.push(
          ...batch.map((badgeId) => ({
            badgeId,
            error: { message: error.message },
          })),
        );

        const remainingBadgeIds = badgeIds.slice(index + batch.length);
        failures.push(
          ...remainingBadgeIds.map((badgeId) => ({
            badgeId,
            error: { message: error.message },
          })),
        );
        break;
      }

      if (index + batch.length < badgeIds.length) {
        await delay(DELETE_INTERVAL_MS);
      }
    }

    deletedBadgeIds.forEach((badgeId) => {
      selectedBadgeIds.delete(badgeId);
      document
        .querySelector(`[data-roblox-extension-badge-id="${badgeId}"]`)
        ?.remove();
    });

    deleting = false;

    if (!failures.length) {
      renderControls(
        `Se eliminaron ${deletedBadgeIds.length} insignias. Actualizando el inventario...`,
        "success",
      );
      setTimeout(() => {
        if (
          generation === deletionGeneration &&
          isOwnInventory &&
          isBadgeInventoryRoute() &&
          getInventoryUserId() === contextUserId
        ) {
          window.location.reload();
        }
      }, 900);
      return;
    }

    const firstMessage = failures[0]?.error?.message;
    renderControls(
      `Se eliminaron ${deletedBadgeIds.length}; ${failures.length} fallaron.${firstMessage ? ` ${firstMessage}` : ""}`,
      "error",
    );
    decorateCards();
  }

  function stopSelection() {
    deletionGeneration += 1;
    selectionMode = false;
    deleting = false;
    selectedBadgeIds.clear();
    document.querySelectorAll(CARD_SELECTOR).forEach((card) => {
      card.classList.remove("roblox-extension-badge-selectable", "is-selected");
      card.removeAttribute("aria-selected");
      delete card.dataset.robloxExtensionBadgeId;
      card.querySelector(".roblox-extension-badge-check")?.remove();
    });
    renderControls();
  }

  function removeRoot() {
    document.getElementById(ROOT_ID)?.remove();
    document
      .querySelector(".roblox-extension-badge-page")
      ?.classList.remove("roblox-extension-badge-page");
  }

  function getInventoryUserId() {
    const match = window.location.pathname.match(
      /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?users\/(\d+)\/inventory\/?$/i,
    );
    const userId = Number(match?.[1]);
    return Number.isSafeInteger(userId) && userId > 0 ? userId : null;
  }

  function isBadgeInventoryRoute() {
    return /^#!\/badges\/?(?:\?.*)?$/i.test(window.location.hash);
  }

  function getBadgeIdFromCard(card) {
    const href = card?.querySelector('a.item-card-link[href*="/badges/"]')?.href;
    const badgeId = Number(href?.match(/\/badges\/(\d+)/i)?.[1]);
    return Number.isSafeInteger(badgeId) && badgeId > 0 ? badgeId : null;
  }

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!response?.ok) {
          const error = new Error(
            response?.error?.message || "La solicitud a Roblox falló.",
          );
          error.code = response?.error?.code || "REQUEST_FAILED";
          reject(error);
          return;
        }

        resolve(response.data);
      });
    });
  }

  function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function escapeHtml(value) {
    const element = document.createElement("span");
    element.textContent = String(value);
    return element.innerHTML;
  }
})();
