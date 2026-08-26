(() => {
  const SERVER_ANALYSIS_PORT_NAME = "roblox-server-analysis";
  const ROOT_ID = "roblox-extension-server-browser";
  const JOIN_REQUEST_EVENT = "roblox-extension:join-server";
  const JOIN_RESULT_EVENT = "roblox-extension:join-server-result";
  const ROUTE_CHANGE_EVENT = "roblox-extension:route-change";
  const NUMBER_FORMATTER = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 0,
  });

  let activeBrowser = null;
  let mountScheduled = false;
  let locatorObserver = null;
  let anchorObserver = null;

  window.addEventListener("popstate", scheduleMount);
  window.addEventListener("hashchange", scheduleMount);
  document.addEventListener(ROUTE_CHANGE_EVENT, scheduleMount);
  document.addEventListener(JOIN_RESULT_EVENT, handleJoinResult);
  scheduleMount();

  function scheduleMount() {
    if (mountScheduled) {
      return;
    }

    mountScheduled = true;
    requestAnimationFrame(() => {
      mountScheduled = false;
      mountForCurrentPage();
    });
  }

  function mountForCurrentPage() {
    const placeId = getPlaceIdFromUrl();

    if (!placeId || !isGameInstancesRoute()) {
      stopDomObservers();
      destroyActiveBrowser();
      return;
    }

    const anchor = findMountAnchor();

    if (!anchor) {
      destroyActiveBrowser();
      observeUntilAnchorExists();
      return;
    }

    if (
      activeBrowser?.placeId === placeId &&
      activeBrowser.anchor === anchor &&
      activeBrowser.root.isConnected
    ) {
      observeAnchorLifecycle(anchor);
      return;
    }

    destroyActiveBrowser();
    const root = createBrowserRoot();
    const state = createInitialState(placeId);
    anchor.parentElement.insertBefore(root, anchor);
    activeBrowser = { anchor, placeId, root, state };
    bindControls(root, state);
    observeAnchorLifecycle(anchor);
    renderStatus(state);
  }

  function createInitialState(placeId) {
    return {
      cachedCount: 0,
      cards: new Map(),
      errorMessage: "",
      failedCount: 0,
      failureReasons: new Map(),
      groups: new Map(),
      joinError: "",
      joinStates: new Map(),
      locationFilter: "all",
      operationId: null,
      pagesFetched: 0,
      paginationComplete: false,
      placeId,
      port: null,
      processedCount: 0,
      requestSortOrder: null,
      servers: new Map(),
      sortBy: "players-asc",
      status: "awaiting-choice",
      totalCount: 0,
    };
  }

  function findMountAnchor() {
    return document.querySelector("#rbx-public-running-games");
  }

  function observeUntilAnchorExists() {
    if (locatorObserver || !isGameInstancesRoute()) {
      return;
    }

    locatorObserver = new MutationObserver(() => {
      if (findMountAnchor()) {
        scheduleMount();
      }
    });
    locatorObserver.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  function observeAnchorLifecycle(anchor) {
    locatorObserver?.disconnect();
    locatorObserver = null;
    anchorObserver?.disconnect();
    const boundary = anchor.parentElement?.parentElement || anchor.parentElement;

    if (!boundary) {
      observeUntilAnchorExists();
      return;
    }

    anchorObserver = new MutationObserver((records) => {
      if (
        !anchor.isConnected ||
        (activeBrowser && !activeBrowser.root.isConnected) ||
        records.some((record) => mutationTouchesMountNodes(record, anchor))
      ) {
        scheduleMount();
      }
    });
    anchorObserver.observe(boundary, { childList: true, subtree: true });
  }

  function mutationTouchesMountNodes(record, anchor) {
    if (isInsideExtensionRoot(record.target)) {
      return false;
    }

    return [...record.addedNodes, ...record.removedNodes].some((node) => {
      if (!(node instanceof Element)) {
        return false;
      }

      if (node.id === ROOT_ID || node.closest?.(`#${ROOT_ID}`)) {
        return false;
      }

      return (
        node === anchor ||
        node.id === "rbx-public-running-games" ||
        node.contains(anchor) ||
        Boolean(node.querySelector?.("#rbx-public-running-games"))
      );
    });
  }

  function isInsideExtensionRoot(node) {
    const element = node instanceof Element ? node : node?.parentElement;
    return Boolean(element?.closest?.(`#${ROOT_ID}`));
  }

  function stopDomObservers() {
    locatorObserver?.disconnect();
    anchorObserver?.disconnect();
    locatorObserver = null;
    anchorObserver = null;
  }

  function createBrowserRoot() {
    const root = document.createElement("section");
    root.id = ROOT_ID;
    root.className = "roblox-extension-server-browser";
    root.setAttribute("aria-labelledby", `${ROOT_ID}-title`);
    root.innerHTML = `
      <div class="roblox-extension-server-browser__header">
        <div>
          <h2 id="${ROOT_ID}-title">Server Browser</h2>
          <p class="roblox-extension-server-browser__subtitle">
            Ubicación aproximada del datacenter obtenida desde la IP pública
            del endpoint UDMUX.
          </p>
        </div>
        <div class="roblox-extension-server-browser__header-actions">
          <button
            class="roblox-extension-server-browser__cancel"
            data-action="cancel"
            type="button"
            hidden
          >Cancelar</button>
          <button
            class="roblox-extension-server-browser__refresh"
            data-action="refresh"
            type="button"
            aria-label="Actualizar servidores"
          >Actualizar</button>
        </div>
      </div>
      <div class="roblox-extension-server-browser__order-choice" data-view="order-choice">
        <h3>¿Qué servidores quieres cargar primero?</h3>
        <p>Elige el orden antes de iniciar el análisis.</p>
        <div class="roblox-extension-server-browser__order-actions">
          <button type="button" data-load-order="Desc">Más jugadores primero</button>
          <button type="button" data-load-order="Asc">Menos jugadores primero</button>
        </div>
      </div>
      <div class="roblox-extension-server-browser__filters" data-view="filters" hidden>
        <label>
          <span>Ubicación</span>
          <select data-control="location">
            <option value="all">Todas las ubicaciones</option>
          </select>
        </label>
        <label>
          <span>Ordenar por</span>
          <select data-control="sort">
            <option value="players-desc">Más jugadores</option>
            <option value="players-asc">Menos jugadores</option>
            <option value="fps">Mayor FPS</option>
          </select>
        </label>
      </div>
      <div class="roblox-extension-server-browser__progress" data-view="progress" role="status" aria-live="polite"></div>
      <div class="roblox-extension-server-browser__message" data-view="message" role="alert" hidden></div>
      <div class="roblox-extension-server-browser__groups" data-view="groups"></div>
    `;
    return root;
  }

  function bindControls(root, state) {
    root.addEventListener("click", (event) => {
      const orderButton = event.target.closest("[data-load-order]");

      if (orderButton) {
        if (state.status === "awaiting-choice") {
          startServerLoad(state, orderButton.dataset.loadOrder);
        }
        return;
      }

      const actionButton = event.target.closest("[data-action]");

      if (!actionButton) {
        return;
      }

      if (actionButton.dataset.action === "cancel") {
        cancelActiveAnalysis(state, true);
      } else if (actionButton.dataset.action === "refresh") {
        startServerLoad(state, state.requestSortOrder);
      } else if (actionButton.dataset.action === "join") {
        requestServerJoin(state, actionButton.dataset.jobId);
      }
    });

    root.addEventListener("change", (event) => {
      if (event.target.matches('[data-control="location"]')) {
        state.locationFilter = event.target.value;
        reconcileAllServerGroups(state);
      } else if (event.target.matches('[data-control="sort"]')) {
        state.sortBy = event.target.value;
        reconcileAllServerGroups(state);
      }
    });
  }

  function startServerLoad(state, sortOrder) {
    if (sortOrder !== "Asc" && sortOrder !== "Desc") {
      return;
    }

    cancelActiveAnalysis(state, false);
    clearJoinStates(state);
    state.cachedCount = 0;
    state.errorMessage = "";
    state.failedCount = 0;
    state.failureReasons.clear();
    state.joinError = "";
    state.locationFilter = "all";
    state.pagesFetched = 0;
    state.paginationComplete = false;
    state.processedCount = 0;
    state.requestSortOrder = sortOrder;
    state.servers.clear();
    state.cards.clear();
    state.groups.clear();
    state.sortBy = sortOrder === "Desc" ? "players-desc" : "players-asc";
    state.status = "loading";
    state.totalCount = 0;
    activeBrowser.root.querySelector('[data-view="groups"]').replaceChildren();

    const operationId = createOperationId();
    let port;

    try {
      port = chrome.runtime.connect({ name: SERVER_ANALYSIS_PORT_NAME });
    } catch (error) {
      state.status = "error";
      state.errorMessage =
        error?.message || "No se pudo iniciar el análisis de servidores.";
      renderStatus(state);
      return;
    }

    state.operationId = operationId;
    state.port = port;
    port.onMessage.addListener((message) =>
      handleAnalysisMessage(state, operationId, message),
    );
    port.onDisconnect.addListener(() => {
      if (
        state.operationId === operationId &&
        (state.status === "loading" || state.status === "analyzing")
      ) {
        state.port = null;
        state.operationId = null;
        state.status = "error";
        state.errorMessage =
          chrome.runtime.lastError?.message ||
          "La conexión con el análisis se cerró inesperadamente.";
        renderStatus(state);
      }
    });
    port.postMessage({
      operationId,
      placeId: state.placeId,
      sortOrder,
      type: "START_ANALYSIS",
    });
    renderStatus(state);
  }

  function handleAnalysisMessage(state, operationId, message) {
    if (
      activeBrowser?.state !== state ||
      state.operationId !== operationId ||
      message?.operationId !== operationId
    ) {
      return;
    }

    if (message.type === "ANALYSIS_STARTED") {
      state.status = "loading";
    } else if (message.type === "ANALYSIS_PROGRESS") {
      applyAnalysisStats(state, message);
      state.status = state.totalCount ? "analyzing" : "loading";
    } else if (message.type === "ANALYSIS_RESULTS") {
      applyAnalysisStats(state, message);
      applyAnalysisFailures(state, message.failures);
      state.status = "analyzing";
      message.results?.forEach((server) => upsertLiveServer(state, server));
    } else if (message.type === "ANALYSIS_COMPLETE") {
      applyAnalysisStats(state, message);
      state.status = "complete";
      finishAnalysisPort(state);
      reconcileAllServerGroups(state);
    } else if (message.type === "ANALYSIS_CANCELLED") {
      applyAnalysisStats(state, message);
      state.status = "cancelled";
      finishAnalysisPort(state);
      reconcileAllServerGroups(state);
    } else if (message.type === "ANALYSIS_ERROR") {
      state.status = "error";
      state.errorMessage =
        message.error?.message || "No se pudo analizar los servidores públicos.";
      finishAnalysisPort(state);
    }

    renderStatus(state);
  }

  function applyAnalysisStats(state, message) {
    state.cachedCount = toNonNegativeInteger(message.cachedCount);
    state.failedCount = toNonNegativeInteger(message.failedCount);
    state.pagesFetched = toNonNegativeInteger(message.pagesFetched);
    state.paginationComplete = Boolean(message.paginationComplete);
    state.processedCount = toNonNegativeInteger(message.processedCount);
    state.totalCount = toNonNegativeInteger(message.totalCount);
  }

  function applyAnalysisFailures(state, failures) {
    if (!Array.isArray(failures)) {
      return;
    }

    failures.forEach((failure) => {
      const reason =
        typeof failure?.reason === "string" && failure.reason
          ? failure.reason
          : "La comprobación regional falló.";
      state.failureReasons.set(
        reason,
        (state.failureReasons.get(reason) || 0) + 1,
      );
    });
  }

  function cancelActiveAnalysis(state, showCancelledState) {
    const port = state.port;
    const operationId = state.operationId;

    state.port = null;
    state.operationId = null;

    if (port && operationId) {
      try {
        port.postMessage({ operationId, type: "CANCEL_ANALYSIS" });
      } catch {
        // Disconnect below is also authoritative cancellation in background.
      }
      port.disconnect();
    }

    if (showCancelledState) {
      state.status = "cancelled";
      state.errorMessage = "";
      reconcileAllServerGroups(state);
      renderStatus(state);
    }
  }

  function finishAnalysisPort(state) {
    const port = state.port;
    state.port = null;
    state.operationId = null;

    if (port) {
      port.disconnect();
    }
  }

  function renderStatus(state) {
    const root = activeBrowser?.state === state ? activeBrowser.root : null;

    if (!root) {
      return;
    }

    const progress = root.querySelector('[data-view="progress"]');
    const message = root.querySelector('[data-view="message"]');
    const orderChoice = root.querySelector('[data-view="order-choice"]');
    const filters = root.querySelector('[data-view="filters"]');
    const sortSelect = root.querySelector('[data-control="sort"]');
    const refreshButton = root.querySelector('[data-action="refresh"]');
    const cancelButton = root.querySelector('[data-action="cancel"]');
    const isAwaitingChoice = state.status === "awaiting-choice";
    const isActive = state.status === "loading" || state.status === "analyzing";

    orderChoice.hidden = !isAwaitingChoice;
    filters.hidden = isAwaitingChoice;
    refreshButton.hidden = isAwaitingChoice;
    cancelButton.hidden = !isActive;
    sortSelect.value = state.sortBy;
    updateLocationOptions(root, state);

    if (isAwaitingChoice) {
      progress.textContent = "";
    } else if (state.status === "loading") {
      progress.textContent = state.pagesFetched
        ? `Buscando servidores públicos: ${state.pagesFetched} página${state.pagesFetched === 1 ? "" : "s"}…`
        : "Buscando servidores públicos…";
    } else if (state.status === "analyzing") {
      const pageText = state.paginationComplete
        ? `${state.pagesFetched} página${state.pagesFetched === 1 ? "" : "s"}`
        : `${state.pagesFetched} página${state.pagesFetched === 1 ? "" : "s"}, buscando más`;
      const cachedText = state.cachedCount
        ? ` · ${state.cachedCount} desde caché`
        : "";
      progress.textContent = `Analizando servidores: ${state.processedCount}/${state.totalCount} · ${pageText}${cachedText}`;
    } else if (state.status === "complete" || state.status === "cancelled") {
      const prefix =
        state.status === "cancelled" ? "Análisis cancelado" : "Análisis completo";
      const parts = [
        prefix,
        `${state.servers.size} servidores`,
        `${state.pagesFetched} página${state.pagesFetched === 1 ? "" : "s"}`,
      ];

      if (state.failedCount) {
        parts.push(`${state.failedCount} omitidos`);
      }
      if (state.cachedCount) {
        parts.push(`${state.cachedCount} desde caché`);
      }
      progress.textContent = parts.join(" · ");
    } else {
      progress.textContent = "";
    }

    const statusMessage = getStatusMessage(state);
    const visibleMessage = state.joinError || statusMessage;
    message.hidden = !visibleMessage;
    message.textContent = visibleMessage;
  }

  function getStatusMessage(state) {
    if (state.status === "error") {
      return state.errorMessage;
    }

    if (state.status === "complete" && state.totalCount === 0) {
      return "No hay servidores públicos disponibles.";
    }

    if (state.status === "complete" && state.servers.size === 0) {
      const topFailure = getTopFailureReason(state.failureReasons);
      return topFailure
        ? `No se pudo analizar ningún servidor: ${topFailure.reason} (${topFailure.count}/${state.failedCount}).`
        : "Roblox no devolvió información de datacenter para los servidores encontrados.";
    }

    return "";
  }

  function upsertLiveServer(state, server) {
    if (!server || typeof server.jobId !== "string") {
      return;
    }

    state.servers.set(server.jobId, server);
    const locationKey = getLocationFilterValue(server.location);
    const matchesFilter =
      state.locationFilter === "all" || state.locationFilter === locationKey;
    const card = ensureServerCard(state, server);

    updateServerCard(card, server, state);

    if (!matchesFilter) {
      card.remove();
      removeEmptyGroups(state);
      return;
    }

    const group = ensureServerGroup(state, locationKey, server.location);
    group.grid.append(card);
    removeEmptyGroups(state);
  }

  function ensureServerGroup(state, key, location) {
    let group = state.groups.get(key);

    if (group) {
      return group;
    }

    const section = document.createElement("section");
    section.className = "roblox-extension-server-group";
    section.dataset.locationKey = key;
    const heading = document.createElement("div");
    heading.className = "roblox-extension-server-group__heading";
    const title = document.createElement("h3");
    title.textContent = getLocationLabel(location);
    heading.append(title);
    const grid = document.createElement("div");
    grid.className = "roblox-extension-server-group__grid";
    section.append(heading, grid);
    group = { grid, label: title.textContent, section };
    state.groups.set(key, group);
    activeBrowser.root.querySelector('[data-view="groups"]').append(section);
    return group;
  }

  function ensureServerCard(state, server) {
    let card = state.cards.get(server.jobId);

    if (card) {
      return card;
    }

    card = document.createElement("article");
    card.className = "roblox-extension-server-card";
    card.dataset.jobId = server.jobId;
    const stats = document.createElement("div");
    stats.className = "roblox-extension-server-card__stats";
    stats.append(
      createStat("Jugadores", "players"),
      createStat("FPS", "fps"),
    );
    const button = document.createElement("button");
    button.className = "roblox-extension-server-card__join";
    button.dataset.action = "join";
    button.dataset.jobId = server.jobId;
    button.type = "button";
    card.append(stats, button);
    state.cards.set(server.jobId, card);
    return card;
  }

  function updateServerCard(card, server, state) {
    card.dataset.locationKey = getLocationFilterValue(server.location);
    card.querySelector('[data-stat="players"]').textContent =
      `${server.players}/${server.maxPlayers}`;
    card.querySelector('[data-stat="fps"]').textContent =
      server.fps === null ? "—" : NUMBER_FORMATTER.format(server.fps);
    updateJoinButton(card, server, state);
  }

  function createStat(label, statName) {
    const wrapper = document.createElement("div");
    const valueElement = document.createElement("strong");
    valueElement.dataset.stat = statName;
    const labelElement = document.createElement("span");
    labelElement.textContent = label;
    wrapper.append(valueElement, labelElement);
    return wrapper;
  }

  function reconcileAllServerGroups(state) {
    const groupsRoot = activeBrowser?.root.querySelector('[data-view="groups"]');

    if (!groupsRoot) {
      return;
    }

    const grouped = new Map();
    [...state.servers.values()]
      .filter(
        (server) =>
          state.locationFilter === "all" ||
          getLocationFilterValue(server.location) === state.locationFilter,
      )
      .sort(getServerComparator(state.sortBy))
      .forEach((server) => {
        const key = getLocationFilterValue(server.location);

        if (!grouped.has(key)) {
          grouped.set(key, { location: server.location, servers: [] });
        }
        grouped.get(key).servers.push(server);
      });

    const sections = [...grouped.entries()]
      .map(([key, entry]) => {
        const group = ensureServerGroup(state, key, entry.location);
        const cards = entry.servers.map((server) => {
          const card = ensureServerCard(state, server);
          updateServerCard(card, server, state);
          return card;
        });
        group.grid.replaceChildren(...cards);
        return group;
      })
      .sort((left, right) => left.label.localeCompare(right.label))
      .map((group) => group.section);

    groupsRoot.replaceChildren(...sections);
  }

  function removeEmptyGroups(state) {
    state.groups.forEach((group) => {
      if (group.section.isConnected && !group.grid.childElementCount) {
        group.section.remove();
      }
    });
  }

  function updateLocationOptions(root, state) {
    const select = root.querySelector('[data-control="location"]');
    const locations = new Map();
    state.servers.forEach((server) => {
      locations.set(
        getLocationFilterValue(server.location),
        getLocationLabel(server.location),
      );
    });
    const nextOptions = [...locations.entries()].sort((left, right) => {
      if (left[0] === "unknown") return 1;
      if (right[0] === "unknown") return -1;
      return left[1].localeCompare(right[1]);
    });
    const currentValues = [...select.options].slice(1).map((option) => option.value);
    const nextValues = nextOptions.map(([value]) => value);

    if (
      currentValues.length !== nextValues.length ||
      !nextValues.every((value, index) => value === currentValues[index])
    ) {
      select.replaceChildren(
        createOption("all", "Todas las ubicaciones"),
        ...nextOptions.map(([value, label]) => createOption(value, label)),
      );
    }

    if (!nextValues.includes(state.locationFilter)) {
      state.locationFilter = "all";
    }
    select.value = state.locationFilter;
  }

  function requestServerJoin(state, jobId) {
    const server = state.servers.get(jobId);

    if (!server || state.joinStates.has(jobId)) {
      return;
    }

    state.joinError = "";
    const timeoutId = setTimeout(() => {
      if (state.joinStates.get(jobId)?.timeoutId === timeoutId) {
        state.joinStates.delete(jobId);
        updateJoinButton(state.cards.get(jobId), server, state);
      }
    }, 7000);
    state.joinStates.set(jobId, { status: "joining", timeoutId });
    updateJoinButton(state.cards.get(jobId), server, state);
    renderStatus(state);
    document.dispatchEvent(
      new CustomEvent(JOIN_REQUEST_EVENT, {
        detail: JSON.stringify({ jobId, placeId: state.placeId }),
      }),
    );
  }

  function updateJoinButton(card, server, state) {
    if (!card) {
      return;
    }

    const button = card.querySelector('[data-action="join"]');
    const joining = state.joinStates.get(server.jobId)?.status === "joining";
    const full = server.maxPlayers > 0 && server.players >= server.maxPlayers;
    button.disabled = joining || full;
    button.textContent = joining ? "Abriendo…" : "Entrar";
  }

  function handleJoinResult(event) {
    if (!activeBrowser) {
      return;
    }

    let result;

    try {
      result = JSON.parse(event.detail);
    } catch {
      return;
    }

    const state = activeBrowser.state;
    const joinState = state.joinStates.get(result.jobId);

    if (joinState) {
      clearTimeout(joinState.timeoutId);
      state.joinStates.delete(result.jobId);
      const server = state.servers.get(result.jobId);
      if (server) updateJoinButton(state.cards.get(result.jobId), server, state);
    }

    state.joinError = result.ok
      ? ""
      : result.message || "No se pudo abrir Roblox Player.";
    renderStatus(state);
  }

  function clearJoinStates(state) {
    state.joinStates.forEach(({ timeoutId }) => clearTimeout(timeoutId));
    state.joinStates.clear();
  }

  function createOption(value, label) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  }

  function getTopFailureReason(failureReasons) {
    let topFailure = null;
    failureReasons.forEach((count, reason) => {
      if (!topFailure || count > topFailure.count) {
        topFailure = { count, reason };
      }
    });
    return topFailure;
  }

  function getServerComparator(sortBy) {
    if (sortBy === "fps") {
      return (left, right) =>
        compareNullableDescending(left.fps, right.fps) ||
        left.players - right.players;
    }
    if (sortBy === "players-desc") {
      return (left, right) =>
        right.players - left.players ||
        compareNullableDescending(left.fps, right.fps);
    }
    return (left, right) =>
      left.players - right.players ||
      compareNullableDescending(left.fps, right.fps);
  }

  function compareNullableDescending(left, right) {
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return right - left;
  }

  function getLocationFilterValue(location) {
    if (!location || typeof location !== "object") return "unknown";
    const parts = [
      location.countryCode,
      location.country,
      getAdministrativeRegion(location),
    ].map((value) =>
      typeof value === "string" ? encodeURIComponent(value) : "",
    );
    return parts.some(Boolean) ? parts.join("|") : "unknown";
  }

  function getLocationLabel(location) {
    if (!location || typeof location !== "object") {
      return "Ubicación no disponible";
    }
    const region = getAdministrativeRegion(location);
    const country = normalizeLocationPart(location.country);
    const parts =
      region && country && region.toLocaleLowerCase() === country.toLocaleLowerCase()
        ? [region]
        : [region, country].filter(Boolean);
    if (!parts.length) return "Ubicación no disponible";
    const flag = getCountryFlag(location.countryCode);
    return `${flag ? `${flag} ` : ""}${parts.join(", ")}`;
  }

  function getAdministrativeRegion(location) {
    return normalizeLocationPart(location?.region) || normalizeLocationPart(location?.city);
  }

  function normalizeLocationPart(value) {
    return typeof value === "string" && value.trim() ? value.trim() : "";
  }

  function getCountryFlag(countryCode) {
    if (typeof countryCode !== "string" || !/^[A-Z]{2}$/.test(countryCode)) {
      return "";
    }
    return String.fromCodePoint(
      ...[...countryCode].map((character) => character.codePointAt(0) + 127397),
    );
  }

  function getPlaceIdFromUrl() {
    const match = window.location.pathname.match(
      /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?games\/(\d+)(?:\/|$)/i,
    );
    if (!match) return null;
    const placeId = Number(match[1]);
    return Number.isSafeInteger(placeId) && placeId > 0 ? placeId : null;
  }

  function isGameInstancesRoute() {
    const hashRoute = window.location.hash.replace(/^#!/, "");
    return (
      hashRoute === "/game-instances" ||
      window.location.pathname.endsWith("/game-instances")
    );
  }

  function createOperationId() {
    if (typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `analysis_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  function toNonNegativeInteger(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
  }

  function destroyActiveBrowser() {
    if (!activeBrowser) {
      return;
    }
    cancelActiveAnalysis(activeBrowser.state, false);
    clearJoinStates(activeBrowser.state);
    activeBrowser.root.remove();
    activeBrowser = null;
  }
})();
