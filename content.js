document.documentElement.classList.add("roblox-extension-pending");

const navigationSelector =
  "#left-navigation-container > div > div > div.width-\\[288px\\] > div > nav > ul";
const homeHeaderSelector = ".home-sort-header-container";
const gameGridSelector = '[data-testid="home-page-game-grid"], .game-grid';
const friendsRootSelector = ".react-friends-carousel-container";
const friendsSectionSelector = ".friend-carousel-container";
const friendsSeeAllSelector = ".people-list-header .see-all-link-icon";
const friendsAddTileSelector =
  ".friends-carousel-tile:has(> #friend-tile-button:not(.options-dropdown))";
const friendsControlsSelector = `${friendsSeeAllSelector}, ${friendsAddTileSelector}`;

const blockedUrls = new Set(
  [
    "https://www.roblox.com/trades",
    "https://www.roblox.com/communities",
    "https://blog.roblox.com/",
    "https://www.roblox.com/giftcards-us",
  ].map(normalizeUrl),
);

const blockedButtonLabels = new Set(["Official Store"]);

let navigationCleaned = false;
let friendsCleaned = false;
let homeCleaned = false;
let updateScheduled = false;
let observer;
let stopObserverTimer;

function normalizeUrl(url) {
  try {
    return new URL(url, window.location.origin).href.replace(/\/$/, "");
  } catch {
    return "";
  }
}

function removeBlockedNavigationItems() {
  if (navigationCleaned) {
    return;
  }

  const navigationList = document.querySelector(navigationSelector);

  if (!navigationList) {
    return;
  }

  navigationList.querySelectorAll("li").forEach((item) => {
    const link = item.querySelector("a[href]");
    const button = item.querySelector("button");

    if (
      (link && blockedUrls.has(normalizeUrl(link.href))) ||
      (button && blockedButtonLabels.has(button.textContent.trim()))
    ) {
      item.remove();
    }
  });

  navigationCleaned = true;
}

function readHomeSections() {
  const sections = [];

  document.querySelectorAll(homeHeaderSelector).forEach((header) => {
    const section = header.parentElement;

    if (!section) {
      return;
    }

    sections.push({
      grid: section.querySelector(gameGridSelector),
      section,
      title: header.textContent.trim().toLowerCase(),
    });
  });

  return sections;
}

function removeFriendsButtons() {
  if (friendsCleaned) {
    return;
  }

  const friendsRoot = document.querySelector(friendsRootSelector);

  if (!friendsRoot) {
    return;
  }

  const friendsSection =
    friendsRoot.closest(friendsSectionSelector) ?? friendsRoot;
  const seeAllLinks = friendsSection.querySelectorAll(friendsSeeAllSelector);
  const addFriendTiles = friendsSection.querySelectorAll(
    friendsAddTileSelector,
  );

  seeAllLinks.forEach((link) => link.remove());
  addFriendTiles.forEach((tile) => tile.remove());

  friendsCleaned = !friendsSection.querySelector(friendsControlsSelector);
}

function normalizeHomeSections() {
  if (homeCleaned) {
    return;
  }

  const sections = readHomeSections();
  const continueSection = sections.find(({ title }) => title === "continue");
  const recommendedSections = sections.filter(
    ({ title }) => title === "recommended for you",
  );
  const standoutSections = sections.filter(({ title }) =>
    title.startsWith("standout games"),
  );

  if (!continueSection || !recommendedSections.length) {
    return;
  }

  continueSection.section.classList.add("roblox-extension-continue-grid");

  const [primaryRecommended, ...duplicateRecommended] = recommendedSections;

  recommendedSections.forEach(({ section }) => {
    section.classList.add("roblox-extension-recommended-section");
  });

  continueSection.section.parentElement?.classList.add(
    "roblox-extension-home-order",
  );

  standoutSections.forEach(({ section }) => {
    section.remove();
  });

  if (primaryRecommended.grid && duplicateRecommended.length) {
    duplicateRecommended.forEach(({ grid, section }) => {
      if (grid) {
        primaryRecommended.grid.append(...grid.children);
      }

      section.remove();
    });
  }

  if (
    continueSection.section.parentElement ===
    primaryRecommended.section.parentElement
  ) {
    primaryRecommended.section.parentElement.insertBefore(
      continueSection.section,
      primaryRecommended.section,
    );
  }

  if (primaryRecommended.grid) {
    homeCleaned =
      duplicateRecommended.length > 0 || standoutSections.length > 0;
    document.documentElement.classList.remove("roblox-extension-pending");
  }
}

function updateRobloxHome() {
  updateScheduled = false;

  removeBlockedNavigationItems();
  removeFriendsButtons();
  normalizeHomeSections();

  if (navigationCleaned && friendsCleaned && homeCleaned && observer) {
    observer.disconnect();
    clearTimeout(stopObserverTimer);
  }
}

function scheduleUpdate() {
  if (updateScheduled) {
    return;
  }

  updateScheduled = true;
  queueMicrotask(updateRobloxHome);
}

observer = new MutationObserver(scheduleUpdate);
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
});

scheduleUpdate();

stopObserverTimer = setTimeout(() => {
  observer.disconnect();
}, 8000);

setTimeout(() => {
  document.documentElement.classList.remove("roblox-extension-pending");
}, 3000);
