const form = document.querySelector("#link-form");
const urlInput = document.querySelector("#medal-url");
const pasteButton = document.querySelector("#paste-button");
const loadButton = document.querySelector("#load-button");
const fileInput = document.querySelector("#video-file");
const dropZone = document.querySelector("#drop-zone");
const mainColumn = document.querySelector(".main-column");
const statusLine = document.querySelector("#status-line");
const clipOverview = document.querySelector("#clip-overview");
const overviewGrid = document.querySelector("#overview-grid");
const overviewCount = document.querySelector("#overview-count");
const clearBatchButton = document.querySelector("#clear-batch");
const batchPlayButton = document.querySelector("#batch-play");
const batchPauseButton = document.querySelector("#batch-pause");
const batchSeek = document.querySelector("#batch-seek");
const batchClock = document.querySelector("#batch-clock");
const batchDuration = document.querySelector("#batch-duration");
const clipItems = [];
let nextClipId = 1;
let batchSyncTimer = null;
let focusedClipId = null;

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
    .then(() => caches.keys())
    .then((keys) => Promise.all(
      keys.filter((key) => key.startsWith("kira-clip-desk-shell-")).map((key) => caches.delete(key)),
    ))
    .catch((error) => console.error("Could not remove the old offline app shell.", error));
}

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

function getBatchReferenceVideo(videos = getPreviewVideos()) {
  const focusedVideo = videos.find((video) => video.closest(".overview-card")?.dataset.clipId === focusedClipId);
  return focusedVideo || videos.find((video) => !video.paused && !video.ended) || videos[0] || null;
}

function seekBatchTo(time) {
  for (const video of getPreviewVideos()) {
    if (Number.isFinite(video.duration)) {
      video.currentTime = Math.max(0, Math.min(time, video.duration));
    }
  }
  updateBatchClock();
}

async function playBatch() {
  const videos = getPreviewVideos();
  const reference = getBatchReferenceVideo(videos);
  if (!reference) return;
  const startTime = reference.currentTime || 0;
  await Promise.all(videos.map(async (video) => {
    if (Number.isFinite(video.duration)) video.currentTime = Math.min(startTime, video.duration);
    try {
      await video.play();
    } catch {
      setStatus("A preview could not start. Use its individual play control.", "error");
    }
  }));
  startBatchSync();
}

function toggleBatchPlayback() {
  const videos = getPreviewVideos();
  if (!videos.length) return;
  if (videos.some((video) => !video.paused && !video.ended)) {
    pauseBatch();
  } else {
    playBatch();
  }
}

function pauseBatch() {
  for (const video of getPreviewVideos()) video.pause();
  stopBatchSync();
}

function moveFocusedClip(direction) {
  const readyItems = clipItems.filter((item) => item.status === "ready");
  if (!readyItems.length) return;
  const currentIndex = readyItems.findIndex((item) => item.id === focusedClipId);
  const nextIndex = currentIndex < 0
    ? (direction > 0 ? 0 : readyItems.length - 1)
    : (currentIndex + direction + readyItems.length) % readyItems.length;
  focusedClipId = readyItems[nextIndex].id;
  syncFocusView();
  overviewGrid.querySelector(`[data-clip-id="${CSS.escape(focusedClipId)}"]`)?.scrollIntoView({
    block: "nearest",
    behavior: "smooth",
  });
}

function isTypingOrUsingControl(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("input, textarea, select, button, a, video, [contenteditable='true'], [role='slider']"));
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
  updateOverviewCount(ready, total);
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

function updateOverviewCount(ready = clipItems.filter((item) => item.status === "ready").length, total = clipItems.length) {
  overviewCount.textContent = total === 1
    ? `${ready} of 1 clip ready`
    : `${ready} of ${total} clips ready`;
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
  const queuedItems = [];
  for (const url of urls) {
    const item = {
      id: `clip-${nextClipId++}`,
      url,
      title: url,
      sourceLabel: "MEDAL CLIP",
      status: "queued",
    };
    queuedItems.push(item);
    clipItems.push(item);
  }
  renderOverview();
  setBusy(true);
  setStatus(`Adding ${urls.length} Medal ${urls.length === 1 ? "clip" : "clips"} to this review.`);

  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < queuedItems.length) {
      const item = queuedItems[nextIndex++];
      await resolveClip(item);
    }
  };
  const workers = Array.from({ length: Math.min(6, urls.length) }, worker);
  await Promise.all(workers);
  setBusy(false);

  const loaded = queuedItems.filter((item) => item.status === "ready").length;
  const failed = queuedItems.length - loaded;
  renderOverview();
  setStatus(
    `${loaded} of ${queuedItems.length} new ${queuedItems.length === 1 ? "clip" : "clips"} ready.${failed ? ` ${failed} could not be loaded and are marked in the queue.` : " Your new clips are added to this review session."}`,
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
  setStatus(`${videos.length} local ${videos.length === 1 ? "clip" : "clips"} added to this review.`);
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
  urlInput.value = "";
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

clearBatchButton.addEventListener("click", () => {
  clearQueue();
  urlInput.value = "";
  setStatus("Batch cleared. Add Medal links or local videos to start a new review.");
  urlInput.focus();
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

batchPlayButton.addEventListener("click", playBatch);

batchPauseButton.addEventListener("click", pauseBatch);

batchSeek.addEventListener("input", () => {
  const time = Number(batchSeek.value) / 10;
  seekBatchTo(time);
});

document.addEventListener("keydown", (event) => {
  if (!clipItems.length || isTypingOrUsingControl(event.target)) return;
  if (event.code === "Space") {
    event.preventDefault();
    toggleBatchPlayback();
  } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    const reference = getBatchReferenceVideo();
    if (!reference || !Number.isFinite(reference.duration)) return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    seekBatchTo(reference.currentTime + direction * 5);
  } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    moveFocusedClip(event.key === "ArrowDown" ? 1 : -1);
  }
});