(() => {
  const SERVER_BROWSER_CONFIG = Object.freeze({
    concurrentRequests: 20,
    maxPages: 20,
  });
  const LIVE_RENDER_INTERVAL_MS = 1000;
  const ROOT_ID = "roblox-extension-server-browser";
  const JOIN_REQUEST_EVENT = "roblox-extension:join-server";
  const JOIN_RESULT_EVENT = "roblox-extension:join-server-result";

  let activeBrowser = null;
  let mountScheduled = false;

  const pageObserver = new MutationObserver(scheduleMount);
  pageObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  window.addEventListener("popstate", scheduleMount);
  window.addEventListener("hashchange", scheduleMount);
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

    if (!placeId) {
      destroyActiveBrowser();
      return;
    }

    if (
      activeBrowser?.placeId === placeId &&
      document.getElementById(ROOT_ID)
    ) {
      return;
    }

    const anchor = findMountAnchor();

    if (!anchor) {
      return;
    }

    destroyActiveBrowser();

    const root = createBrowserRoot();
    const generation = Symbol("server-browser-generation");
    const state = {
      cachedCount: 0,
      failureReasons: new Map(),
      failedCount: 0,
      generation,
      lastRenderAt: 0,
      locationFilter: "all",
      pagesFetched: 0,
      placeId,
      processedCount: 0,
      renderPending: false,
      renderTimer: null,
      servers: [],
      sortBy: "players",
      status: "loading",
      totalCount: 0,
      truncated: false,
    };

    anchor.parentElement.insertBefore(root, anchor);
    activeBrowser = { placeId, root, state };
    bindControls(root, state);
    render(state);
    loadServers(state);
  }

  function findMountAnchor() {
    const selectors = [
      "#game-instances",
      "[data-testid='game-instances']",
      ".game-instances",
      ".game-server-list",
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);

      if (element?.parentElement) {
        return element;
      }
    }

    const fallback = document.querySelector(
      "#game-detail-page, .game-detail-page, main",
    );

    if (!fallback) {
      return null;
    }

    const marker = document.createElement("div");
    marker.className = "roblox-extension-server-browser-anchor";
    fallback.appendChild(marker);
    return marker;
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
        <button
          class="roblox-extension-server-browser__refresh"
          type="button"
          aria-label="Actualizar servidores"
        >
          Actualizar
        </button>
      </div>
      <div class="roblox-extension-server-browser__filters">
        <label>
          <span>Ubicación</span>
          <select data-control="location">
            <option value="all">Todas las ubicaciones</option>
          </select>
        </label>
        <label>
          <span>Ordenar por</span>
          <select data-control="sort">
            <option value="players">Menos jugadores</option>
            <option value="fps">Mayor FPS</option>
          </select>
        </label>
      </div>
      <div
        class="roblox-extension-server-browser__progress"
        data-view="progress"
        role="status"
        aria-live="polite"
      ></div>
      <div
        class="roblox-extension-server-browser__message"
        data-view="message"
        role="alert"
        hidden
      ></div>
      <div
        class="roblox-extension-server-browser__groups"
        data-view="groups"
      ></div>
    `;

    return root;
  }

  function bindControls(root, state) {
    root
      .querySelector('[data-control="location"]')
      .addEventListener("change", (event) => {
        state.locationFilter = event.target.value;
        render(state);
      });

    root
      .querySelector('[data-control="sort"]')
      .addEventListener("change", (event) => {
        state.sortBy = event.target.value;
        render(state);
      });

    root
      .querySelector(".roblox-extension-server-browser__refresh")
      .addEventListener("click", () => {
        if (state.status === "loading" || state.status === "analyzing") {
          return;
        }

        state.generation = Symbol("server-browser-refresh");
        state.cachedCount = 0;
        state.failureReasons.clear();
        state.failedCount = 0;
        state.locationFilter = "all";
        state.pagesFetched = 0;
        state.processedCount = 0;
        state.servers = [];
        state.status = "loading";
        state.totalCount = 0;
        state.truncated = false;
        cancelScheduledRender(state);
        render(state);
        loadServers(state);
      });
  }

  async function loadServers(state) {
    const generation = state.generation;

    try {
      const result = await sendMessage({
        maxPages: SERVER_BROWSER_CONFIG.maxPages,
        placeId: state.placeId,
        type: "FETCH_PUBLIC_SERVERS",
      });

      if (!isCurrent(state, generation)) {
        return;
      }

      state.pagesFetched = result.pagesFetched;
      state.totalCount = result.servers.length;
      state.truncated = result.truncated;
      state.status = result.servers.length ? "analyzing" : "complete";
      render(state);

      if (!result.servers.length) {
        return;
      }

      await analyzeServers(state, result.servers, generation);

      if (!isCurrent(state, generation)) {
        return;
      }

      cancelScheduledRender(state);
      state.status = "complete";
      render(state);
    } catch (error) {
      if (!isCurrent(state, generation)) {
        return;
      }

      cancelScheduledRender(state);
      state.status = "error";
      state.errorMessage =
        error?.message || "No se pudieron cargar los servidores públicos.";
      render(state);
    }
  }

  async function analyzeServers(state, publicServers, generation) {
    let nextIndex = 0;
    const workerCount = Math.min(
      SERVER_BROWSER_CONFIG.concurrentRequests,
      publicServers.length,
    );

    const workers = Array.from({ length: workerCount }, async () => {
      while (isCurrent(state, generation)) {
        const index = nextIndex;
        nextIndex += 1;

        if (index >= publicServers.length) {
          return;
        }

        const publicServer = publicServers[index];

        try {
          const details = await sendMessage({
            jobId: publicServer.jobId,
            placeId: state.placeId,
            type: "GET_SERVER_REGION",
          });

          if (!isCurrent(state, generation)) {
            return;
          }

          state.servers.push({
            ...publicServer,
            location: details.location,
          });

          if (details.cached) {
            state.cachedCount += 1;
          }
        } catch (error) {
          if (!isCurrent(state, generation)) {
            return;
          }

          state.failedCount += 1;
          const reason =
            error?.details?.cause ||
            error?.message ||
            "La comprobación regional falló.";
          state.failureReasons.set(
            reason,
            (state.failureReasons.get(reason) || 0) + 1,
          );
        } finally {
          if (isCurrent(state, generation)) {
            state.processedCount += 1;
            scheduleRender(state);
          }
        }
      }
    });

    await Promise.all(workers);
  }

  function scheduleRender(state) {
    if (state.renderPending) {
      return;
    }

    state.renderPending = true;
    const waitTime = Math.max(
      0,
      LIVE_RENDER_INTERVAL_MS - (Date.now() - state.lastRenderAt),
    );
    state.renderTimer = setTimeout(() => {
      state.renderPending = false;
      state.renderTimer = null;

      if (activeBrowser?.state === state) {
        render(state);
      }
    }, waitTime);
  }

  function cancelScheduledRender(state) {
    if (state.renderTimer !== null) {
      clearTimeout(state.renderTimer);
      state.renderTimer = null;
    }

    state.renderPending = false;
  }

  function render(state) {
    const root = activeBrowser?.state === state ? activeBrowser.root : null;

    if (!root) {
      return;
    }

    state.lastRenderAt = Date.now();

    const progress = root.querySelector('[data-view="progress"]');
    const message = root.querySelector('[data-view="message"]');
    const groupsRoot = root.querySelector('[data-view="groups"]');
    const refreshButton = root.querySelector(
      ".roblox-extension-server-browser__refresh",
    );

    refreshButton.disabled =
      state.status === "loading" || state.status === "analyzing";
    updateLocationOptions(root, state);

    if (state.status === "loading") {
      progress.textContent = "Buscando servidores públicos…";
    } else if (state.status === "analyzing") {
      const cachedText = state.cachedCount
        ? ` · ${state.cachedCount} desde caché`
        : "";
      progress.textContent = `Analizando servidores: ${state.processedCount}/${state.totalCount}${cachedText}`;
    } else if (state.status === "complete") {
      const parts = [
        `${state.servers.length} servidores analizados`,
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

    if (state.status === "error") {
      message.hidden = false;
      message.textContent = state.errorMessage;
    } else if (
      state.status === "complete" &&
      state.truncated &&
      state.servers.length > 0
    ) {
      message.hidden = false;
      message.textContent = `Se analizaron los primeros ${state.totalCount} servidores (${SERVER_BROWSER_CONFIG.maxPages} páginas) para evitar esperas excesivas.`;
    } else if (
      state.status === "complete" &&
      state.totalCount === 0
    ) {
      message.hidden = false;
      message.textContent = "No hay servidores públicos disponibles.";
    } else if (
      state.status === "complete" &&
      state.servers.length === 0
    ) {
      message.hidden = false;
      const topFailure = getTopFailureReason(state.failureReasons);
      message.textContent = topFailure
        ? `No se pudo analizar ningún servidor: ${topFailure.reason} (${topFailure.count}/${state.failedCount}).`
        : "Roblox no devolvió información de datacenter para los servidores encontrados.";
    } else {
      message.hidden = true;
      message.textContent = "";
    }

    renderServerGroups(groupsRoot, state);
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
      if (left[0] === "unknown") {
        return 1;
      }

      if (right[0] === "unknown") {
        return -1;
      }

      return left[1].localeCompare(right[1]);
    });
    const currentOptions = [...select.options]
      .slice(1)
      .map((option) => option.value);
    const nextValues = nextOptions.map(([value]) => value);
    const selected = nextValues.includes(state.locationFilter)
      ? state.locationFilter
      : "all";

    if (
      nextValues.length !== currentOptions.length ||
      !nextValues.every((value, index) => value === currentOptions[index])
    ) {
      select.replaceChildren(
        createOption("all", "Todas las ubicaciones"),
        ...nextOptions.map(([value, label]) => createOption(value, label)),
      );
    }

    select.value = selected;
    state.locationFilter = selected;
  }

  function renderServerGroups(groupsRoot, state) {
    const filtered = state.servers
      .filter((server) => {
        return (
          state.locationFilter === "all" ||
          getLocationFilterValue(server.location) === state.locationFilter
        );
      })
      .sort(getServerComparator(state.sortBy));
    const groups = new Map();

    filtered.forEach((server) => {
      const key = getLocationFilterValue(server.location);

      if (!groups.has(key)) {
        groups.set(key, {
          locationLabel: getLocationLabel(server.location),
          servers: [],
        });
      }

      const group = groups.get(key);
      group.servers.push(server);
    });

    const fragment = document.createDocumentFragment();

    [...groups.values()]
      .sort((left, right) =>
        left.locationLabel.localeCompare(right.locationLabel),
      )
      .forEach((group) => fragment.appendChild(createServerGroup(group, state)));

    groupsRoot.replaceChildren(fragment);
  }

  function createServerGroup(group, state) {
    const section = document.createElement("section");
    section.className = "roblox-extension-server-group";

    const heading = document.createElement("div");
    heading.className = "roblox-extension-server-group__heading";

    const title = document.createElement("h3");
    title.textContent = group.locationLabel;
    heading.append(title);

    const grid = document.createElement("div");
    grid.className = "roblox-extension-server-group__grid";
    group.servers.forEach((server) => {
      grid.appendChild(createServerCard(server, state));
    });

    section.append(heading, grid);
    return section;
  }

  function createServerCard(server, state) {
    const card = document.createElement("article");
    card.className = "roblox-extension-server-card";

    const stats = document.createElement("div");
    stats.className = "roblox-extension-server-card__stats";
    stats.append(
      createStat(
        "Jugadores",
        `${server.players}/${server.maxPlayers}`,
      ),
      createStat(
        "FPS",
        server.fps === null ? "—" : formatNumber(server.fps),
      ),
    );

    const button = document.createElement("button");
    button.className = "roblox-extension-server-card__join";
    button.type = "button";
    button.textContent = "Entrar";
    button.disabled =
      server.maxPlayers > 0 && server.players >= server.maxPlayers;
    button.addEventListener("click", () => {
      button.disabled = true;
      button.textContent = "Abriendo…";
      button.dataset.joiningJobId = server.jobId;

      document.dispatchEvent(
        new CustomEvent(JOIN_REQUEST_EVENT, {
          detail: JSON.stringify({
            jobId: server.jobId,
            placeId: state.placeId,
          }),
        }),
      );

      setTimeout(() => {
        if (button.isConnected && button.dataset.joiningJobId) {
          button.disabled = false;
          button.textContent = "Entrar";
          delete button.dataset.joiningJobId;
        }
      }, 7000);
    });

    card.append(stats, button);
    return card;
  }

  function createStat(label, value) {
    const wrapper = document.createElement("div");
    const valueElement = document.createElement("strong");
    const labelElement = document.createElement("span");
    valueElement.textContent = value;
    labelElement.textContent = label;
    wrapper.append(valueElement, labelElement);
    return wrapper;
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

    const message = activeBrowser.root.querySelector('[data-view="message"]');
    const joiningButton = activeBrowser.root.querySelector(
      `[data-joining-job-id="${cssEscape(result.jobId || "")}"]`,
    );

    if (joiningButton) {
      joiningButton.disabled = false;
      joiningButton.textContent = "Entrar";
      delete joiningButton.dataset.joiningJobId;
    }

    if (!result.ok) {
      message.hidden = false;
      message.textContent =
        result.message || "No se pudo abrir Roblox Player.";
    }
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

    return (left, right) =>
      left.players - right.players ||
      compareNullableDescending(left.fps, right.fps);
  }

  function compareNullableDescending(left, right) {
    if (left === null && right === null) {
      return 0;
    }

    if (left === null) {
      return 1;
    }

    if (right === null) {
      return -1;
    }

    return right - left;
  }

  function getLocationFilterValue(location) {
    if (!location || typeof location !== "object") {
      return "unknown";
    }

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
      region &&
      country &&
      region.toLocaleLowerCase() === country.toLocaleLowerCase()
        ? [region]
        : [region, country].filter(Boolean);

    if (!parts.length) {
      return "Ubicación no disponible";
    }

    const flag = getCountryFlag(location.countryCode);
    return `${flag ? `${flag} ` : ""}${parts.join(", ")}`;
  }

  function getAdministrativeRegion(location) {
    return (
      normalizeLocationPart(location?.region) ||
      normalizeLocationPart(location?.city)
    );
  }

  function normalizeLocationPart(value) {
    return typeof value === "string" && value.trim() ? value.trim() : "";
  }

  function getCountryFlag(countryCode) {
    if (
      typeof countryCode !== "string" ||
      !/^[A-Z]{2}$/.test(countryCode)
    ) {
      return "";
    }

    return String.fromCodePoint(
      ...[...countryCode].map((character) =>
        character.codePointAt(0) + 127397,
      ),
    );
  }

  function formatNumber(value) {
    return new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 0,
    }).format(value);
  }

  function getPlaceIdFromUrl() {
    const match = window.location.pathname.match(/^\/games\/(\d+)(?:\/|$)/);

    if (!match) {
      return null;
    }

    const placeId = Number(match[1]);
    return Number.isSafeInteger(placeId) && placeId > 0 ? placeId : null;
  }

  function isCurrent(state, generation) {
    return (
      activeBrowser?.state === state &&
      state.generation === generation &&
      getPlaceIdFromUrl() === state.placeId
    );
  }

  function destroyActiveBrowser() {
    if (!activeBrowser) {
      return;
    }

    activeBrowser.state.generation = Symbol("destroyed");
    cancelScheduledRender(activeBrowser.state);
    activeBrowser.root.remove();
    activeBrowser = null;
  }

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(
            new Error(
              chrome.runtime.lastError.message ||
                "No se pudo comunicar con la extensión.",
            ),
          );
          return;
        }

        if (!response?.ok) {
          const error = new Error(
            response?.error?.message || "La solicitud a Roblox falló.",
          );
          error.code = response?.error?.code || "REQUEST_FAILED";
          error.details = response?.error?.details || {};
          reject(error);
          return;
        }

        resolve(response.data);
      });
    });
  }

  function cssEscape(value) {
    if (window.CSS?.escape) {
      return window.CSS.escape(value);
    }

    return String(value).replace(/["\\]/g, "\\$&");
  }
})();
