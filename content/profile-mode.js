const PROFILE_MODE_KEY = "profileRedesignEnabled";
const TOGGLE_ID = "roblox-extension-profile-mode-toggle";

export function getProfileRedesignEnabled() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get({ [PROFILE_MODE_KEY]: true }, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(result[PROFILE_MODE_KEY] !== false);
    });
  });
}

export function watchProfileRedesignEnabled(listener) {
  const handleChange = (changes, areaName) => {
    if (areaName !== "local" || !(PROFILE_MODE_KEY in changes)) {
      return;
    }

    listener(changes[PROFILE_MODE_KEY].newValue !== false);
  };

  chrome.storage.onChanged.addListener(handleChange);
  return () => chrome.storage.onChanged.removeListener(handleChange);
}

export function mountProfileModeToggle(enabled, onChange) {
  let root = document.getElementById(TOGGLE_ID);

  if (root) {
    updateProfileModeToggle(enabled);
    return root;
  }

  root = document.createElement("aside");
  root.id = TOGGLE_ID;
  root.setAttribute("aria-label", "Profile design preference");

  const copy = document.createElement("span");
  copy.className = "rx-profile-mode-copy";
  const title = document.createElement("strong");
  title.textContent = "Profile redesign";
  const status = document.createElement("small");
  status.dataset.profileModeStatus = "";
  copy.append(title, status);

  const label = document.createElement("label");
  label.className = "rx-profile-mode-switch";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("role", "switch");
  input.setAttribute("aria-label", "Use profile redesign");
  input.checked = enabled;
  const track = document.createElement("span");
  track.className = "rx-profile-mode-track";
  label.append(input, track);
  root.append(copy, label);
  document.body.append(root);
  updateProfileModeToggle(enabled);

  input.addEventListener("change", async () => {
    const nextValue = input.checked;
    input.disabled = true;

    try {
      await setProfileRedesignEnabled(nextValue);
      onChange(nextValue);
    } catch (error) {
      input.checked = !nextValue;
      status.textContent = error?.message || "Preference could not be saved";
      root.dataset.state = "error";
    } finally {
      input.disabled = false;
    }
  });

  return root;
}

export function updateProfileModeToggle(enabled) {
  const root = document.getElementById(TOGGLE_ID);
  const input = root?.querySelector('input[type="checkbox"]');
  const status = root?.querySelector("[data-profile-mode-status]");

  if (!root || !input || !status) {
    return;
  }

  input.checked = enabled;
  status.textContent = enabled ? "Redesigned" : "Roblox default";
  root.dataset.state = enabled ? "redesigned" : "default";
}

export function removeProfileModeToggle() {
  document.getElementById(TOGGLE_ID)?.remove();
}

function setProfileRedesignEnabled(enabled) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [PROFILE_MODE_KEY]: enabled }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve();
    });
  });
}
