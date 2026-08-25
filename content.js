const pathname = location.pathname;
const isHome = /^\/home\/?$/.test(pathname);

document.documentElement.classList.toggle("roblox-extension-home-active", isHome);
document.documentElement.classList.remove("roblox-extension-profile-active");

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
