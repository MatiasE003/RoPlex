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

export function setAvatarContent(container, avatarUrl, initial, options = {}) {
  container.textContent = initial;

  if (typeof avatarUrl !== "string" || !avatarUrl.startsWith("https://")) {
    return;
  }

  const image = document.createElement("img");
  image.alt = "";
  if (options.decoding) image.decoding = options.decoding;
  if (options.loading) image.loading = options.loading;
  image.referrerPolicy = "no-referrer";
  image.src = avatarUrl;
  image.addEventListener("error", () => container.replaceChildren(initial), {
    once: true,
  });
  container.replaceChildren(image);
}

export function handleHorizontalCarouselWheel(event, target = event.currentTarget) {
  if (event.ctrlKey) {
    return;
  }

  const carousel = target;
  const rawDelta =
    Math.abs(event.deltaY) >= Math.abs(event.deltaX)
      ? event.deltaY
      : event.deltaX;
  const multiplier =
    event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 32
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? carousel.clientWidth
        : 1;
  const delta = rawDelta * multiplier;
  const maximumScroll = carousel.scrollWidth - carousel.clientWidth;
  const canMove =
    (delta > 0 && carousel.scrollLeft < maximumScroll - 1) ||
    (delta < 0 && carousel.scrollLeft > 1);

  if (!delta) {
    return;
  }

  event.preventDefault();

  if (canMove) {
    carousel.scrollLeft += delta;
  }
}
