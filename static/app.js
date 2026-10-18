const form = document.querySelector("#link-form");
const urlInput = document.querySelector("#medal-url");
const pasteButton = document.querySelector("#paste-button");
const loadButton = document.querySelector("#load-button");
const fileInput = document.querySelector("#video-file");
const dropZone = document.querySelector("#drop-zone");
const mainColumn = document.querySelector(".main-column");
const installButton = document.querySelector("#install-app");
const statusLine = document.querySelector("#status-line");
const clipOverview = document.querySelector("#clip-overview");
const overviewGrid = document.querySelector("#overview-grid");
const overviewCount = document.querySelector("#overview-count");
const batchPlayButton = document.querySelector("#batch-play");
const batchPauseButton = document.querySelector("#batch-pause");
const batchSeek = document.querySelector("#batch-seek");
const batchClock = document.querySelector("#batch-clock");
const batchDuration = document.querySelector("#batch-duration");
const clipItems = [];
let nextClipId = 1;
let batchSyncTimer = null;
let focusedClipId = null;
let installPrompt = null;

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/service-worker.js")
    .catch((error) => console.error("Could not register the offline app shell.", error));
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  installButton.hidden = false;
});

installButton.addEventListener("click", async () => {
  if (!installPrompt) return;
  installButton.disabled = true;
  try {
    await installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    installButton.hidden = true;
  } catch (error) {
    console.error("Could not open the app installation prompt.", error);
    setStatus("App installation could not be started. Use your browser's install option.", "error");
  } finally {
    installButton.disabled = false;
  }
});

window.addEventListener("appinstalled", () => {
  installPrompt = null;
  installButton.hidden = true;
  setStatus("Kira Clip Desk was installed successfully.");
});

function setStatus(message, kind = "") {
  statusLine.textContent = message;
  statusLine.dataset.kind = kind;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "Length unavailable";
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function getPreviewVideos() {
  return Array.from(overviewGrid.querySelectorAll(".overview-media video"));
}

function updateBatchControls() {
  const videos = getPreviewVideos();
  const knownDurations = clipItems
    .filter((item) => Number.isFinite(item.duration))
    .map((item) => item.duration);
  const loadedDurations = videos
    .map((video) => video.duration)
    .filter(Number.isFinite);
  const duration = Math.max(0, ...knownDurations, ...loadedDurations);
  batchPlayButton.disabled = videos.length === 0 || videos.some((video) => video.readyState < 1);
  batchPauseButton.disabled = videos.length === 0;
  batchSeek.disabled = videos.length === 0 || duration === 0;
  batchSeek.max = String(Math.round(duration * 10));
  batchDuration.textContent = duration ? formatDuration(duration) : "--:--";
  updateBatchClock();
}

function updateBatchClock() {
  const firstVideo = getPreviewVideos()[0];
  if (!firstVideo || !Number.isFinite(firstVideo.currentTime)) {
    batchClock.textContent = "00:00";
    batchSeek.value = "0";
    return;
  }
  batchClock.textContent = formatDuration(firstVideo.currentTime);
  batchSeek.value = String(Math.round(firstVideo.currentTime * 10));
}

function clearQueue() {
  stopBatchSync();
  for (const video of getPreviewVideos()) video.pause();
  for (const item of clipItems) {
    if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
  }
  clipItems.length = 0;
  focusedClipId = null;
  renderOverview();
}

function renderOverview() {
  const total = clipItems.length;
  const ready = clipItems.filter((item) => item.status === "ready").length;
  document.body.classList.toggle("batch-active", total > 0);
  clipOverview.hidden = total === 0;
  dropZone.hidden = total > 0;
  overviewCount.textContent = `${String(ready).padStart(2, "0")} / ${String(total).padStart(2, "0")} READY`;
  overviewGrid.replaceChildren();

  clipItems.forEach((item, index) => {
    const card = document.createElement("article");
    card.className = "overview-card";
    card.dataset.clipId = item.id;
    card.dataset.clipIndex = String(index);
    card.setAttribute("aria-current", String(item.id === focusedClipId));

    const media = document.createElement("div");
    media.className = "overview-media";
    if (item.status === "ready") {
      const preview = document.createElement("video");
      preview.src = item.videoUrl;
      preview.controls = true;
      preview.muted = item.id !== focusedClipId;
      preview.playsInline = true;
      preview.preload = "metadata";
      preview.setAttribute("aria-label", `Preview ${item.title}`);
      preview.addEventListener("loadedmetadata", () => {
        item.duration = preview.duration;
        updateBatchControls();
        if (preview.currentTime === 0 && preview.duration > 0.1) {
          preview.currentTime = 0.1;
        }
      });
      preview.addEventListener("durationchange", updateBatchControls);
      preview.addEventListener("timeupdate", updateBatchClock);
      media.append(preview);
    } else {
      const unavailable = document.createElement("span");
      unavailable.className = "overview-unavailable";
      unavailable.textContent = item.status === "error" ? "CLIP UNAVAILABLE" : item.status.toUpperCase();
      media.append(unavailable);
    }

    const footer = document.createElement("div");
    footer.className = "overview-card-footer";
    const identity = document.createElement("div");
    identity.className = "overview-identity";
    const number = document.createElement("span");
    number.className = "overview-number";
    number.textContent = String(index + 1).padStart(2, "0");
    const details = document.createElement("div");
    details.className = "overview-details";
    const title = document.createElement("p");
    title.className = "overview-title";
    title.textContent = item.title;
    const metadata = document.createElement("p");
    metadata.className = "overview-metadata";
    metadata.textContent = item.status === "ready"
      ? [item.uploader || item.sourceLabel, Number.isFinite(item.duration) ? formatDuration(item.duration) : ""].filter(Boolean).join(" / ")
      : item.error || item.sourceLabel;
    details.append(title, metadata);
    identity.append(number, details);

    const focusButton = document.createElement("button");
    focusButton.type = "button";
    focusButton.className = "overview-focus";
    focusButton.disabled = item.status !== "ready";
    focusButton.textContent = item.id === focusedClipId ? "EXIT FOCUS" : "FOCUS";
    focusButton.addEventListener("click", () => {
      focusedClipId = focusedClipId === item.id ? null : item.id;
      syncFocusView();
    });
    footer.append(identity, focusButton);
    card.append(media, footer);
    overviewGrid.append(card);
  });
  syncFocusView();
  updateBatchControls();
}

function syncFocusView() {
  const cards = Array.from(overviewGrid.querySelectorAll(".overview-card"));
  for (const card of cards) {
    const isFocused = card.dataset.clipId === focusedClipId;
    card.setAttribute("aria-current", String(isFocused));
    const button = card.querySelector(".overview-focus");
    button.textContent = isFocused ? "EXIT FOCUS" : "FOCUS";
    const video = card.querySelector("video");
    if (video) video.muted = !isFocused;
  }
  cards.sort((first, second) => {
    if (first.dataset.clipId === focusedClipId) return -1;
    if (second.dataset.clipId === focusedClipId) return 1;
    return Number(first.dataset.clipIndex) - Number(second.dataset.clipIndex);
  });
  for (const card of cards) overviewGrid.append(card);
}

function setBusy(isBusy) {
  loadButton.disabled = isBusy;
  pasteButton.disabled = isBusy;
  fileInput.disabled = isBusy;
}

async function resolveClip(item) {
  item.status = "resolving";
  try {
    const response = await fetch("/api/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: item.url }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The clip could not be loaded.");
    item.videoUrl = result.video_url;
    item.title = result.title || item.title;
    item.uploader = result.uploader;
    item.duration = result.duration;
    item.status = "ready";
    item.sourceLabel = "MEDAL CLIP";
  } catch (error) {
    item.status = "error";
    item.error = error.message || "Could not load clip.";
  }
}

async function loadMedalLinks(urls) {
  clearQueue();
  for (const url of urls) {
    clipItems.push({
      id: `clip-${nextClipId++}`,
      url,
      title: url,
      sourceLabel: "MEDAL CLIP",
      status: "queued",
    });
  }
  renderOverview();
  setBusy(true);
  setStatus(`Resolving ${urls.length} clips in parallel.`);

  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < clipItems.length) {
      const item = clipItems[nextIndex++];
      await resolveClip(item);
    }
  };
  const workers = Array.from({ length: Math.min(6, urls.length) }, worker);
  await Promise.all(workers);
  setBusy(false);

  const loaded = clipItems.filter((item) => item.status === "ready").length;
  const failed = clipItems.length - loaded;
  renderOverview();
  setStatus(
    `${loaded} of ${clipItems.length} clips ready for review.${failed ? ` ${failed} failed; unavailable clips are marked in the grid.` : " Use Play All or control each clip independently."}`,
    failed ? "error" : "",
  );
}

function addLocalFiles(files) {
  if (loadButton.disabled) {
    setStatus("Wait for the current batch to finish before adding another.", "error");
    return;
  }
  const videos = Array.from(files).filter((file) => file.type.startsWith("video/"));
  if (!videos.length) {
    setStatus("Choose one or more supported video files.", "error");
    return;
  }

  clearQueue();
  for (const file of videos) {
    const objectUrl = URL.createObjectURL(file);
    clipItems.push({
      id: `clip-${nextClipId++}`,
      title: file.name,
      sourceLabel: "LOCAL VIDEO",
      status: "ready",
      uploader: "Local file",
      objectUrl,
      videoUrl: objectUrl,
    });
  }
  renderOverview();
  setStatus(`${videos.length} local ${videos.length === 1 ? "clip" : "clips"} ready in the batch view.`);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const urls = urlInput.value.split(/\s+/).filter(Boolean);
  if (!urls.length) {
    urlInput.focus();
    setStatus("Paste one or more Medal links first.", "error");
    return;
  }
  loadButton.disabled = true;
  await loadMedalLinks(urls);
});

pasteButton.addEventListener("click", async () => {
  try {
    urlInput.value = (await navigator.clipboard.readText()).trim();
    urlInput.focus();
    setStatus(urlInput.value ? "Link pasted. Ready to load." : "Clipboard is empty.");
  } catch {
    urlInput.focus();
    setStatus("Clipboard access blocked. Paste with Ctrl+V.");
  }
});

fileInput.addEventListener("change", () => {
  addLocalFiles(fileInput.files);
  fileInput.value = "";
});

dropZone.addEventListener("click", () => fileInput.click());

for (const eventName of ["dragenter", "dragover"]) {
  mainColumn.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  mainColumn.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragging");
  });
}
mainColumn.addEventListener("drop", (event) => addLocalFiles(event.dataTransfer.files));

function stopBatchSync() {
  if (batchSyncTimer !== null) {
    clearInterval(batchSyncTimer);
    batchSyncTimer = null;
  }
}

function startBatchSync() {
  stopBatchSync();
  batchSyncTimer = setInterval(() => {
    const videos = getPreviewVideos();
    const reference = videos.find((video) => !video.paused && !video.ended);
    if (!reference) {
      stopBatchSync();
      return;
    }
    for (const video of videos) {
      if (video === reference || video.paused || video.ended || !Number.isFinite(video.duration)) continue;
      if (Math.abs(video.currentTime - reference.currentTime) > 0.2) {
        video.currentTime = Math.min(reference.currentTime, video.duration);
      }
    }
    updateBatchClock();
  }, 250);
}

batchPlayButton.addEventListener("click", async () => {
  const videos = getPreviewVideos();
  const startTime = videos[0]?.currentTime || 0;
  await Promise.all(videos.map(async (video) => {
    if (Number.isFinite(video.duration)) video.currentTime = Math.min(startTime, video.duration);
    try {
      await video.play();
    } catch {
      setStatus("A preview could not start. Use its individual play control.", "error");
    }
  }));
  startBatchSync();
});

batchPauseButton.addEventListener("click", () => {
  for (const video of getPreviewVideos()) video.pause();
  stopBatchSync();
});

batchSeek.addEventListener("input", () => {
  const time = Number(batchSeek.value) / 10;
  for (const video of getPreviewVideos()) {
    if (Number.isFinite(video.duration)) video.currentTime = Math.min(time, video.duration);
  }
  batchClock.textContent = formatDuration(time);
});