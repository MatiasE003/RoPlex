export function createRetryButton(handler) {
  const retry = document.createElement("button");
  retry.className = "rx-inline-retry";
  retry.type = "button";
  retry.textContent = "Retry";
  retry.addEventListener("click", handler, { once: true });
  return retry;
}

export function createInlineState(message) {
  const state = document.createElement("div");
  const text = document.createElement("p");
  state.className = "rx-inline-state";
  text.textContent = message;
  state.append(text);
  return state;
}

export function formatCompactNumber(value) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    notation: value >= 1000 ? "compact" : "standard",
  }).format(value);
}

export function setAvatarContent(container, avatarUrl, initial) {
  container.textContent = initial;

  if (typeof avatarUrl !== "string" || !avatarUrl.startsWith("https://")) {
    return;
  }

  const image = document.createElement("img");
  image.alt = "";
  image.referrerPolicy = "no-referrer";
  image.src = avatarUrl;
  image.addEventListener("error", () => container.replaceChildren(initial), {
    once: true,
  });
  container.replaceChildren(image);
}
