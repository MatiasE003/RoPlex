import { MESSAGE_TYPES } from "./config.js";
import { sendMessage } from "./messaging.js";
import { setAvatarContent } from "./ui.js";

// Stateful custom elements own their lifecycle and request state.
export class HomeSearch extends HTMLElement {
  connectedCallback() {
    if (this.form) {
      document.addEventListener("pointerdown", this.handleDocumentPointerDown);
      return;
    }

    this.innerHTML = `
      <form class="rx-search" action="/discover/" method="get">
        <svg class="rx-icon"><use href="#rx-search"></use></svg>
        <input name="Keyword" type="search" placeholder="Search" aria-label="Search Roblox" autocomplete="off" aria-controls="rx-search-panel" aria-expanded="false" />
        <div class="rx-search-panel" id="rx-search-panel" hidden>
          <section class="rx-search-section" aria-labelledby="rx-search-people-title">
            <span class="rx-search-section-title" id="rx-search-people-title">Players</span>
            <div class="rx-search-users" aria-live="polite"></div>
          </section>
          <section class="rx-search-section rx-search-destination-section" aria-labelledby="rx-search-destinations-title">
            <span class="rx-search-section-title" id="rx-search-destinations-title">Search in</span>
            <div class="rx-search-destinations"></div>
          </section>
        </div>
      </form>
    `;
    this.form = this.querySelector("form");
    this.input = this.querySelector("input");
    this.panel = this.querySelector(".rx-search-panel");
    this.users = this.querySelector(".rx-search-users");
    this.destinations = this.querySelector(".rx-search-destinations");
    this.handleDocumentPointerDown = (event) => {
      if (!this.contains(event.target)) {
        this.close();
      }
    };

    this.input.addEventListener("input", () => this.handleInput());
    this.input.addEventListener("focus", () => {
      if (this.input.value.trim()) {
        this.open();
      }
    });
    this.input.addEventListener("keydown", (event) => this.handleInputKey(event));
    this.panel.addEventListener("keydown", (event) => this.handlePanelKey(event));
    this.form.addEventListener("submit", (event) => {
      if (!this.input.value.trim()) {
        event.preventDefault();
      }
    });
    document.addEventListener("pointerdown", this.handleDocumentPointerDown);
  }

  disconnectedCallback() {
    clearTimeout(this.searchTimer);
    document.removeEventListener("pointerdown", this.handleDocumentPointerDown);
  }

  handleInput() {
    const query = this.input.value.trim();
    const requestId = (this.requestId || 0) + 1;
    this.requestId = requestId;
    clearTimeout(this.searchTimer);

    if (!query) {
      this.users.replaceChildren();
      this.destinations.replaceChildren();
      this.close();
      return;
    }

    this.open();
    renderHomeSearchDestinations(this.destinations, query);

    if (query.length < 3) {
      renderHomeSearchMessage(
        this.users,
        "Type at least 3 characters to find players.",
      );
      return;
    }

    renderHomeSearchMessage(this.users, "Searching players...", "loading");
    this.searchTimer = setTimeout(() => this.loadUsers(query, requestId), 250);
  }

  async loadUsers(query, requestId) {
    try {
      const data = await sendMessage({ type: MESSAGE_TYPES.userSearch, query });

      if (requestId === this.requestId && this.isConnected) {
        renderHomeSearchUsers(this.users, data, query);
      }
    } catch (error) {
      if (requestId === this.requestId && this.isConnected) {
        renderHomeSearchMessage(
          this.users,
          error?.message || "Player search is temporarily unavailable.",
          "error",
        );
      }
    }
  }

  open() {
    this.panel.hidden = false;
    this.input.setAttribute("aria-expanded", "true");
  }

  close() {
    this.panel.hidden = true;
    this.input.setAttribute("aria-expanded", "false");
  }

  handleInputKey(event) {
    if (event.key === "Escape") {
      this.close();
      return;
    }

    if (event.key === "ArrowDown" && !this.panel.hidden) {
      const firstLink = this.panel.querySelector("a");

      if (firstLink) {
        event.preventDefault();
        firstLink.focus();
      }
    }
  }

  handlePanelKey(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      this.close();
      this.input.focus();
      return;
    }

    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }

    const links = [...this.panel.querySelectorAll("a")];
    const currentIndex = links.indexOf(document.activeElement);

    if (!links.length || currentIndex < 0) {
      return;
    }

    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    links[(currentIndex + direction + links.length) % links.length].focus();
  }
}

function renderHomeSearchUsers(container, data, query) {
  if (!data || !Array.isArray(data.users)) {
    throw new Error("Roblox returned invalid player search results.");
  }

  if (!data.users.length) {
    renderHomeSearchMessage(container, `No players found for “${query}”.`);
    return;
  }

  container.replaceChildren(
    ...data.users.map((user) => createHomeSearchUser(user, query)),
  );
}

// Presentation helpers are stateless: data in, DOM node out.
function createHomeSearchUser(user, query) {
  const link = document.createElement("a");
  const avatar = document.createElement("span");
  const copy = document.createElement("span");
  const displayName = document.createElement("strong");
  const username = document.createElement("small");
  const normalizedQuery = query.toLocaleLowerCase();
  const previousMatch = user.previousUsernames?.find((name) =>
    name.toLocaleLowerCase().includes(normalizedQuery),
  );
  const initial = Array.from(user.displayName.trim())[0]?.toUpperCase() || "?";

  link.className = "rx-search-user";
  link.href = `/users/${user.id}/profile`;
  link.setAttribute("aria-label", `View ${user.displayName}'s profile`);
  avatar.className = "rx-search-avatar";
  avatar.textContent = initial;
  copy.className = "rx-search-user-copy";
  displayName.textContent = user.displayName;
  username.textContent = previousMatch
    ? `@${user.username} · Previously @${previousMatch}`
    : `@${user.username}`;
  setAvatarContent(avatar, user.avatarUrl, initial);
  copy.append(displayName, username);
  link.append(avatar, copy);
  return link;
}

function renderHomeSearchDestinations(container, query) {
  const encodedQuery = encodeURIComponent(query);
  const destinations = [
    ["Players", `/search/users?keyword=${encodedQuery}`],
    ["Experiences", `/discover/?Keyword=${encodedQuery}`],
    ["Communities", `/search/groups?keyword=${encodedQuery}`],
    [
      "Roblox docs",
      `https://www.google.com/search?q=${encodeURIComponent(`site:create.roblox.com/docs ${query}`)}`,
    ],
  ];

  container.replaceChildren(
    ...destinations.map(([label, href]) => {
      const link = document.createElement("a");
      const icon = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
      );
      const use = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "use",
      );
      const text = document.createElement("span");

      link.className = "rx-search-destination";
      link.href = href;
      icon.classList.add("rx-icon");
      use.setAttribute("href", "#rx-search");
      text.textContent = `${label}: “${query}”`;
      icon.append(use);
      link.append(icon, text);
      return link;
    }),
  );
}

function renderHomeSearchMessage(container, message, state = "idle") {
  const element = document.createElement("p");
  element.className = "rx-search-message";
  element.dataset.state = state;
  element.textContent = message;
  container.replaceChildren(element);
}
