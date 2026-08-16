document.documentElement.classList.add("roblox-extension-home-active");

import(chrome.runtime.getURL("content/main.js")).catch((error) => {
  console.error("Roblox Extension Home failed to load.", error);
  document.documentElement.classList.remove("roblox-extension-home-active");
  document.getElementById("roblox-extension-home")?.remove();
});
