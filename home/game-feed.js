import { EVENTS, GAME_FEEDS } from "../shared/config.js";
import { sendMessage } from "../shared/messaging.js";
import {
  createInlineState,
  createRetryButton,
  formatCompactNumber,
  handleHorizontalCarouselWheel,
} from "../shared/ui.js";

// Stateful custom elements own their lifecycle and request state.
export class GameFeed extends HTMLElement {
  connectedCallback() {
    if (this.content) {
      this.addUserEventListeners();
      return;
    }

    this.config = GAME_FEEDS[this.getAttribute("feed")];

    if (!this.config) {
      throw new Error("The game feed configuration is invalid.");
    }

    const feed = this.getAttribute("feed");
    const titleId = `rx-${feed}-title`;
    const headingClass = this.config.landscape
      ? "rx-section-heading"
      : "rx-section-heading rx-carousel-heading";
    const hint = this.config.landscape ? "" : "<span>Scroll to explore</span>";
    const contentClass = this.config.landscape
      ? "rx-recommended-grid"
      : "rx-game-carousel";
    const accessibility = this.config.ariaLabel
      ? ` tabindex="0" aria-label="${this.config.ariaLabel}"`
      : "";

    this.innerHTML = `
      <section class="rx-section" id="rx-${feed}" aria-labelledby="${titleId}">
        <div class="${headingClass}"><h2 id="${titleId}">${this.config.title}</h2>${hint}</div>
        <div class="${contentClass}" data-${feed}-content aria-live="polite"${accessibility}></div>
      </section>
    `;
    this.content = this.querySelector(`[data-${feed}-content]`);
    this.handleUserReady = (event) => {
      if (this.config.requiresUser) {
        this.load(event.detail.userId);
      }
    };
    this.handleUserError = () => {
      if (this.config.requiresUser) {
        this.renderBlocked();
      }
    };
    this.handleHomeRefresh = () => {
      if (this.config.requiresUser) {
        this.requestId = (this.requestId || 0) + 1;
        this.renderLoading();
      } else {
        this.load();
      }
    };
    this.addUserEventListeners();

    if (!this.config.landscape) {
      this.content.addEventListener("wheel", handleHorizontalCarouselWheel, {
        passive: false,
      });
    }

    if (!this.config.requiresUser) {
      this.load();
    } else {
      this.renderLoading();
    }
  }

  disconnectedCallback() {
    this.requestId = (this.requestId || 0) + 1;
    document.removeEventListener(EVENTS.userReady, this.handleUserReady);
    document.removeEventListener(EVENTS.userError, this.handleUserError);
    document.removeEventListener(EVENTS.homeRefresh, this.handleHomeRefresh);
  }

  addUserEventListeners() {
    document.addEventListener(EVENTS.userReady, this.handleUserReady);
    document.addEventListener(EVENTS.userError, this.handleUserError);
    document.addEventListener(EVENTS.homeRefresh, this.handleHomeRefresh);
  }

  async load(userId = this.userId) {
    if (this.config.requiresUser && !Number.isSafeInteger(userId)) {
      this.renderBlocked();
      return;
    }

    this.userId = userId;
    const requestId = (this.requestId || 0) + 1;
    this.requestId = requestId;
    this.renderLoading();

    try {
      const data = await sendMessage({
        type: this.config.messageType,
        ...(this.config.requiresUser ? { userId } : {}),
      });

      if (requestId === this.requestId && this.isConnected) {
        this.renderGames(data);
      }
    } catch (error) {
      if (requestId === this.requestId && this.isConnected) {
        this.renderError(error?.message || this.config.errorMessage);
      }
    }
  }

  renderLoading() {
    const count = this.config.landscape ? 8 : 7;
    const skeletonClass = this.config.landscape
      ? "rx-game-skeleton rx-game-skeleton-landscape"
      : "rx-game-skeleton";
    this.setContentState("ready");
    this.content.replaceChildren(
      ...Array.from({ length: count }, () => {
        const skeleton = document.createElement("div");
        skeleton.className = skeletonClass;
        return skeleton;
      }),
    );
  }

  renderGames(data) {
    if (!data || !Array.isArray(data.games)) {
      throw new Error(this.config.invalidMessage);
    }

    if (!data.games.length) {
      this.renderMessage(this.config.emptyMessage);
      return;
    }

    this.setContentState("ready");
    this.content.replaceChildren(
      ...data.games.map((game) => createGameCard(game, this.config.landscape)),
    );
  }

  renderBlocked() {
    this.requestId = (this.requestId || 0) + 1;
    this.renderMessage(this.config.blockedMessage);
  }

  renderMessage(message, retry = false) {
    const state = createInlineState(message);

    if (retry) {
      state.append(createRetryButton(() => this.load()));
    }

    this.setContentState("message");
    this.content.replaceChildren(state);
  }

  renderError(message) {
    this.renderMessage(message, true);
  }

  setContentState(state) {
    if (state === "ready") {
      this.content.className = this.config.landscape
        ? "rx-recommended-grid"
        : "rx-game-carousel";
      return;
    }

    this.content.className = this.config.landscape
      ? "rx-recommended-state"
      : "rx-game-carousel-state";
  }
}

// Presentation helpers are stateless: data in, DOM node out.
function createGameCard(game, landscape = false) {
  const card = document.createElement("a");
  const thumbnail = document.createElement("span");
  const fallback = document.createElement("span");
  const play = document.createElement("i");
  const name = document.createElement("strong");
  const stats = document.createElement("span");
  const rating = document.createElement("span");
  const players = document.createElement("span");
  const initial = Array.from(game.name.trim())[0]?.toUpperCase() || "?";

  card.className = landscape
    ? "rx-game-card rx-game-card-landscape"
    : "rx-game-card";
  card.href = `/games/${game.placeId}`;
  card.setAttribute("aria-label", `Open ${game.name}`);
  thumbnail.className = landscape
    ? "rx-game-thumbnail rx-game-thumbnail-landscape"
    : "rx-game-thumbnail";
  fallback.className = "rx-game-fallback";
  fallback.textContent = initial;
  play.className = "rx-game-play";
  name.className = "rx-game-name";
  name.textContent = game.name;
  name.title = game.name;
  stats.className = "rx-game-stats";
  rating.textContent = game.rating === null ? "-- rating" : `${game.rating}%`;
  players.textContent = `${formatCompactNumber(game.playerCount)} playing`;

  if (
    typeof game.imageUrl === "string" &&
    game.imageUrl.startsWith("https://")
  ) {
    const image = document.createElement("img");
    image.alt = "";
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    image.src = game.imageUrl;
    thumbnail.append(image, play);
  } else {
    thumbnail.append(fallback, play);
  }

  stats.append(rating, players);
  card.append(thumbnail, name, stats);
  return card;
}
