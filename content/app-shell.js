const icons = `
  <svg class="rx-icon-defs" aria-hidden="true">
    <symbol id="rx-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></symbol>
    <symbol id="rx-home" viewBox="0 0 24 24"><path d="m3 11 9-8 9 8"></path><path d="M5 10v10h14V10M9 20v-6h6v6"></path></symbol>
    <symbol id="rx-user" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"></circle><path d="M4 21a8 8 0 0 1 16 0"></path></symbol>
    <symbol id="rx-user-plus" viewBox="0 0 24 24"><circle cx="9" cy="8" r="4"></circle><path d="M2 21a7 7 0 0 1 14 0M19 8v6M16 11h6"></path></symbol>
    <symbol id="rx-users" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"></path></symbol>
    <symbol id="rx-avatar" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"></circle><path d="M7 14h10l2 7H5l2-7Z"></path></symbol>
    <symbol id="rx-box" viewBox="0 0 24 24"><path d="m4 7 8-4 8 4-8 4-8-4Z"></path><path d="M4 7v10l8 4 8-4V7M12 11v10"></path></symbol>
    <symbol id="rx-message" viewBox="0 0 24 24"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"></path></symbol>
    <symbol id="rx-more" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle></symbol>
    <symbol id="rx-bell" viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"></path></symbol>
    <symbol id="rx-robux" viewBox="0 0 24 24"><path d="m12 2.5 9.5 9.5-9.5 9.5L2.5 12 12 2.5Z"></path><path d="m12 8.5 3.5 3.5-3.5 3.5L8.5 12 12 8.5Z"></path></symbol>
    <symbol id="rx-gear" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"></circle><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1A7 7 0 0 0 15 6l-.3-2.6h-4L10.4 6A7 7 0 0 0 9 7L6.5 6l-2 3.4 2 1.5a7 7 0 0 0 0 2L4.5 14l2 3.4L9 17a7 7 0 0 0 1.5.9l.3 2.6h4l.3-2.6a7 7 0 0 0 1.5-.9l2.4.5 2-3.4-2-1.2a7 7 0 0 0 .1-1Z"></path></symbol>
    <symbol id="rx-switch-account" viewBox="0 0 24 24"><path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3"></path><path d="m10 17 5-5-5-5M15 12H3"></path></symbol>
    <symbol id="rx-premium" viewBox="0 0 24 24"><path d="m12 3 3 6 6 .8-4.5 4.5 1.1 6.2L12 17.6l-5.6 2.9 1.1-6.2L3 9.8 9 9l3-6Z"></path></symbol>
    <symbol id="rx-refresh" viewBox="0 0 24 24"><path d="M20 7v5h-5M4 17v-5h5"></path><path d="M18.5 9A7 7 0 0 0 6 6.5L4 9M5.5 15A7 7 0 0 0 18 17.5l2-2.5"></path></symbol>
    <symbol id="rx-calendar" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M16 3v4M8 3v4M3 10h18"></path></symbol>
    <symbol id="rx-check" viewBox="0 0 24 24"><path d="m6 12 4 4 8-9"></path></symbol>
    <symbol id="rx-award" viewBox="0 0 24 24"><circle cx="12" cy="8" r="5"></circle><path d="m8.5 12-1 9 4.5-3 4.5 3-1-9"></path></symbol>
  </svg>
`;

export function createAppShellMarkup({
  active = "home",
  loadingAccount = false,
  main = "",
} = {}) {
  const homeActive = active === "home" ? "active" : "";
  const profileActive = active === "profile" ? "active" : "";
  const accountName = loadingAccount ? "Loading account" : "Not signed in";
  const accountStatus = loadingAccount ? "Please wait" : "Roblox account";
  const accountHref = loadingAccount ? "/home" : "/login";

  return `
    ${icons}
    <header class="rx-topbar">
      <a class="rx-brand" href="/home" aria-label="Roblox Home"><i class="rx-brand-mark"></i><span>ROBLOX</span></a>
      <nav class="rx-primary-nav" aria-label="Roblox sections"><a class="${homeActive}" href="/home">Home</a><a href="/charts">Charts</a><a href="/catalog">Marketplace</a><a href="/create">Create</a></nav>
      <div class="rx-topbar-tools"><rx-home-search></rx-home-search><a class="rx-top-icon" href="/notifications" aria-label="Notifications"><svg class="rx-icon"><use href="#rx-bell"></use></svg></a><a class="rx-top-icon rx-robux-balance" href="/upgrades/robux" aria-label="Robux balance"><svg class="rx-icon"><use href="#rx-robux"></use></svg><span data-user-robux>--</span></a><details class="rx-account-menu"><summary class="rx-top-icon" aria-label="Account options"><svg class="rx-icon"><use href="#rx-gear"></use></svg></summary><div class="rx-account-menu-panel"><a href="/my/account"><svg class="rx-icon"><use href="#rx-gear"></use></svg><span>Settings</span></a><button type="button" data-account-switch><svg class="rx-icon"><use href="#rx-switch-account"></use></svg><span>Switch account</span></button></div></details></div>
    </header>
    <aside class="rx-sidebar">
      <a class="rx-user-summary" data-user-profile-link href="${accountHref}"><span class="rx-avatar" data-user-avatar><span data-user-initial>?</span></span><span class="rx-user-copy"><strong data-user-display-name>${accountName}</strong><small data-user-username>${accountStatus}</small></span></a>
      <nav aria-label="Account navigation"><ul class="rx-side-nav">
        <li><a class="${homeActive}" href="/home"><svg class="rx-icon"><use href="#rx-home"></use></svg><span>Home</span></a></li>
        <li><a class="${profileActive}" data-user-profile-link href="${accountHref}"><svg class="rx-icon"><use href="#rx-user"></use></svg><span>Profile</span></a></li>
        <li><a href="/my/messages/#!/inbox"><svg class="rx-icon"><use href="#rx-message"></use></svg><span>Messages</span></a></li>
        <li><a data-user-friends-link href="${accountHref}"><svg class="rx-icon"><use href="#rx-users"></use></svg><span>Friends</span></a></li>
        <li><a href="/my/avatar"><svg class="rx-icon"><use href="#rx-avatar"></use></svg><span>Avatar</span></a></li>
        <li><a data-user-inventory-link href="${accountHref}"><svg class="rx-icon"><use href="#rx-box"></use></svg><span>Inventory</span></a></li>
        <li><a href="/more"><svg class="rx-icon"><use href="#rx-more"></use></svg><span>More</span></a></li>
      </ul></nav>
      <a class="rx-premium-link" href="/premium/membership"><span class="rx-premium-icon"><svg class="rx-icon"><use href="#rx-premium"></use></svg></span><span>Get Premium</span></a>
    </aside>
    <main class="rx-main">${main}</main>
  `;
}

export function renderShellAuthenticatedUser(root, user) {
  const userId = Number(user?.id);
  const displayName = typeof user?.displayName === "string" ? user.displayName.trim() : "";
  const username = typeof user?.username === "string" ? user.username.trim() : "";

  if (!Number.isSafeInteger(userId) || userId <= 0 || !displayName || !username) {
    throw new Error("Roblox returned an invalid account profile.");
  }

  const initial = Array.from(displayName)[0]?.toUpperCase() || "?";
  setText(root, "[data-user-display-name]", displayName);
  setText(root, "[data-user-username]", `@${username}`);
  setText(root, "[data-user-initial]", initial);
  setLinks(root, "[data-user-profile-link]", `/users/${userId}/profile`);
  setLinks(root, "[data-user-friends-link]", `/users/${userId}/friends#!/friends`);
  setLinks(root, "[data-user-inventory-link]", `/users/${userId}/inventory`);
  root.querySelectorAll("[data-user-robux]").forEach((element) => {
    const balance = Number.isSafeInteger(user.robux) && user.robux >= 0
      ? new Intl.NumberFormat("en-US").format(user.robux)
      : "--";
    element.textContent = balance;
    element.closest("a")?.setAttribute("aria-label", `Robux balance: ${balance}`);
  });

  if (typeof user.avatarUrl === "string" && user.avatarUrl.startsWith("https://")) {
    root.querySelectorAll("[data-user-avatar]").forEach((element) => {
      const image = document.createElement("img");
      image.alt = "";
      image.referrerPolicy = "no-referrer";
      image.src = user.avatarUrl;
      element.replaceChildren(image);
    });
  }
}

export function renderShellSignedOut(root) {
  setText(root, "[data-user-display-name]", "Not signed in");
  setText(root, "[data-user-username]", "Roblox account");
  setText(root, "[data-user-robux]", "--");
  setLinks(root, "[data-user-profile-link]", "/login");
  setLinks(root, "[data-user-friends-link]", "/login");
  setLinks(root, "[data-user-inventory-link]", "/login");
  root.querySelectorAll("[data-user-avatar]").forEach((element) => {
    const initial = document.createElement("span");
    initial.dataset.userInitial = "";
    initial.textContent = "?";
    element.replaceChildren(initial);
  });
}

function setText(root, selector, value) {
  root.querySelectorAll(selector).forEach((element) => {
    element.textContent = value;
  });
}

function setLinks(root, selector, href) {
  root.querySelectorAll(selector).forEach((element) => {
    element.href = href;
  });
}
