import { EVENTS } from "./config.js";

const pendingHomeJoins = new Map();

export function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!response?.ok) {
        reject(
          new Error(
            response?.error?.message ||
              "The extension did not return a valid response.",
          ),
        );
        return;
      }

      resolve(response.data);
    });
  });
}

export function startHomeJoin(button, status, placeId, jobId) {
  button.disabled = true;
  button.textContent = "Opening...";
  status.textContent = "";
  pendingHomeJoins.set(jobId, { button, status });
  document.dispatchEvent(
    new CustomEvent(EVENTS.joinRequest, {
      detail: JSON.stringify({ jobId, placeId }),
    }),
  );

  setTimeout(() => {
    const pending = pendingHomeJoins.get(jobId);

    if (pending?.button === button) {
      resetHomeJoin(jobId, pending);
    }
  }, 7000);
}

export function installHomeJoinResultListener() {
  document.addEventListener(EVENTS.joinResult, handleHomeJoinResult);
}

function handleHomeJoinResult(event) {
  let result;

  try {
    result = JSON.parse(event.detail);
  } catch {
    return;
  }

  const pending = pendingHomeJoins.get(result.jobId);

  if (!pending || result.ok) {
    return;
  }

  pending.status.textContent =
    result.message || "Roblox Player could not be opened.";
  resetHomeJoin(result.jobId, pending, false);
}

function resetHomeJoin(jobId, pending, clearStatus = true) {
  pending.button.disabled = false;
  pending.button.textContent = "Join";

  if (clearStatus) {
    pending.status.textContent = "";
  }

  pendingHomeJoins.delete(jobId);
}
