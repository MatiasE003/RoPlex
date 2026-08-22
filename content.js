const pathname = location.pathname;
const isHome = /^\/home\/?$/.test(pathname);
const profileMatch =
  /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?users\/([1-9]\d*)\/profile\/?$/i.exec(
    pathname,
  );
const profileUserId = profileMatch ? Number(profileMatch[1]) : null;
const isProfile = Number.isSafeInteger(profileUserId) && profileUserId > 0;

document.documentElement.classList.toggle("roblox-extension-home-active", isHome);
document.documentElement.classList.toggle(
  "roblox-extension-profile-active",
  isProfile,
);

import(chrome.runtime.getURL("content/main.js")).catch((error) => {
  console.error("Roblox Extension frontend failed to load.", error);
  document.documentElement.classList.remove(
    "roblox-extension-home-active",
    "roblox-extension-profile-active",
  );
  document.getElementById("roblox-extension-home")?.remove();
  document.getElementById("roblox-extension-profile")?.remove();
  document.getElementById("roblox-extension-profile-mode-toggle")?.remove();
});
