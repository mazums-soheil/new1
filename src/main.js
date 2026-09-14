(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (a, b, x) => {
    const t = clamp((x - a) / Math.max(1e-6, b - a));
    return t * t * (3 - 2 * t);
  };
  const fadeWindow = (p, start, end, feather = 0.07) => {
    const f = Math.min(feather, Math.max(0.02, (end - start) * 0.34));
    return smoothstep(start, start + f, p) * (1 - smoothstep(end - f, end, p));
  };

  const body = document.body;
  const loader = $('#loader');
  const loaderTrack = $('#loaderTrack');
  const loaderStatus = $('#loaderStatus');
  const loaderPercent = $('#loaderPercent');
  const loaderAssetCount = $('#loaderAssetCount');
  const loaderBytes = $('#loaderBytes');
  const loaderError = $('#loaderError');
  const loaderErrorText = $('#loaderErrorText');
  const loaderRetry = $('#loaderRetry');
  const loaderStages = $$('[data-loader-stage]');
  const topbar = $('#topbar');
  const heroSection = $('#cinematic');
  const heroVideo = $('#heroVideo');
  const filmCard = $('#filmCard');
  const heroVolume = $('#heroVolume');
  const cinemaTransition = $('#cinemaTransition');
  const frameReadout = $('#frameReadout');
  const heroTimecode = $('#heroTimecode');
  const heroProgressEl = $('#heroProgress');
  const railFill = $('#railFill');
  const railIndex = $('#railIndex');
  const heroScenes = $$('.hero-scene');
  const sections = $$('[data-chapter]');
  const soundButton = $('#soundButton');
  const backgroundMusic = $('#backgroundMusic');
  const heartbeatAudio = $('#heartbeatAudio');
  const cursor = $('#cursor');
  const depthCanvas = $('#depthCanvas');
  const confettiCanvas = $('#confettiCanvas');
  const helixCanvas = $('#helixCanvas');
  const inviteStage = $('#inviteStage');
  const inviteCard = $('#inviteCard');
  const mailIntro = $('#mailIntro');
  const mailStage = $('#mailStage');
  const mailEnvelope = $('#mailEnvelope');
  const mailCard = $('#mailCard');
  const mailSeal = $('#mailSeal');
  const finaleSection = $('#finale');
  const storyLinks = $$('#storyDock a');
  const topbarNavLinks = $$('.topbar__nav a');

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const mobile = matchMedia('(max-width: 820px)').matches || coarse;
  const saveData = !!navigator.connection?.saveData;
  const deviceMemory = navigator.deviceMemory || 8;
  const lowPower = reduceMotion || saveData || deviceMemory <= 4 || (navigator.hardwareConcurrency || 8) <= 4;

  const FPS = 15;
  const TOTAL_FRAMES = 231;

  let viewportH = innerHeight;
  let viewportW = innerWidth;
  let scrollY = window.scrollY;
  let targetHeroP = 0;
  let smoothHeroP = 0;
  let targetFrame = 0;
  let displayedFrame = 0;
  let lastAppliedFrame = -1;
  let preloadedVideoURL = null;
  let backgroundMusicBlobURL = null;
  let heartbeatBlobURL = null;
  let heroReady = false;
  let heroVideoFailed = false;
  let heroVideoLoadPromise = null;
  let heroBlobWarmPromise = null;
  let heroStoryGateUntil = 0;
  let loaderClosed = false;
  let raf = 0;
  let lastScrollY = scrollY;
  let scrollVelocity = 0;
  let pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  let lastLook = { x: 99, y: 99 };
  let lookFrame = 0;
  let chapterMetrics = [];
  let activeChapter = 0;

  // Content-aware autoplay timeline. Manual vertical scrolling is blocked; the
  // story advances automatically with section durations derived from both the
  // amount of text and the physical scroll distance.
  const AUTO_SCROLL_CONFIG = {
    rates: [1, 1.5, 2, 2.5, 3],
    defaultRateIndex: 0,
    wordsPerMinute: 220,
    initialDelayMs: 1100,
    minSeconds: { hero: 28, chapter: 12, finale: 21 },
    maxSeconds: { hero: 36, chapter: 17, finale: 30 },
    readingPaddingSeconds: { hero: 4, chapter: 3.5, finale: 5.5 },
    pixelsPerSecond: { hero: 145, chapter: 125, finale: 105 }
  };

  const autoScroll = {
    segments: [],
    segmentIndex: 0,
    segmentProgress: 0,
    rateIndex: AUTO_SCROLL_CONFIG.defaultRateIndex,
    active: false,
    paused: false,
    ended: false,
    manualOverride: false,
    resumeAt: 0,
    lastTime: performance.now()
  };

  const autoScrollControl = $('#autoScrollControl');
  const autoScrollToggle = $('#autoScrollToggle');
  const autoScrollSpeed = $('#autoScrollSpeed');

  function maxScrollY() {
    return Math.max(0, document.documentElement.scrollHeight - innerHeight);
  }

  function manualScrollStartY() {
    if (!finaleSection) return Infinity;
    return clamp(finaleSection.offsetTop, 0, maxScrollY());
  }

  function isInvitationManualZone(y = window.scrollY) {
    return y >= manualScrollStartY() - 2;
  }

  function updateInvitationManualReadiness(y = window.scrollY) {
    body.classList.toggle(
      'invitation-manual-ready',
      body.classList.contains('invitation-entered') && isInvitationManualZone(y)
    );
  }

  function setManualScrollPhase(active) {
    const enabled = !!active;
    autoScroll.manualOverride = enabled;
    body.classList.toggle('manual-scroll-active', enabled);
    if (enabled) {
      autoScroll.active = false;
      autoScroll.paused = false;
      autoScroll.lastTime = performance.now();
    }
    updateInvitationManualReadiness();
    updateAutoScrollControls();
  }

  function countReadableWords(el) {
    if (!el) return 0;
    const clone = el.cloneNode(true);
    clone.querySelectorAll('script,style,svg,canvas,video,audio,.chapter__number,.hero-chrome,.rail,.finale__footer').forEach((node) => node.remove());
    const text = (clone.textContent || '').replace(/\s+/g, ' ').trim();
    return text ? text.split(' ').filter(Boolean).length : 0;
  }

  function durationForSection(el, startY, endY, kind) {
    const words = countReadableWords(el);
    const readingSeconds = (words / AUTO_SCROLL_CONFIG.wordsPerMinute) * 60 + AUTO_SCROLL_CONFIG.readingPaddingSeconds[kind];
    const distanceSeconds = Math.max(0, endY - startY) / AUTO_SCROLL_CONFIG.pixelsPerSecond[kind];
    const wanted = Math.max(readingSeconds, distanceSeconds);
    return clamp(wanted, AUTO_SCROLL_CONFIG.minSeconds[kind], AUTO_SCROLL_CONFIG.maxSeconds[kind]);
  }

  function buildAutoScrollTimeline() {
    const maxY = maxScrollY();
    const raw = [];
    if (heroSection) raw.push({ el: heroSection, kind: 'hero' });
    sections.forEach((el) => raw.push({ el, kind: el.classList.contains('finale') ? 'finale' : 'chapter' }));

    autoScroll.segments = raw.map((item, index) => {
      const startY = clamp(item.el.offsetTop, 0, maxY);
      const nextTop = raw[index + 1]?.el?.offsetTop;
      const endY = clamp(index === raw.length - 1 ? maxY : (nextTop ?? maxY), startY, maxY);
      return {
        ...item,
        startY,
        endY,
        duration: durationForSection(item.el, startY, endY, item.kind)
      };
    }).filter((segment, index, arr) => segment.endY > segment.startY || index === arr.length - 1);
  }

  function currentAutoRate() {
    return AUTO_SCROLL_CONFIG.rates[autoScroll.rateIndex] || 1;
  }

  function updateAutoScrollControls() {
    const faRates = ['۱×', '۱٫۵×', '۲×', '۲٫۵×', '۳×'];
    if (autoScrollSpeed) {
      autoScrollSpeed.textContent = faRates[autoScroll.rateIndex] || `${currentAutoRate()}×`;
      autoScrollSpeed.setAttribute('aria-label', `تغییر سرعت پخش خودکار؛ سرعت فعلی ${currentAutoRate()} برابر`);
    }
    if (autoScrollToggle) {
      const replay = autoScroll.ended;
      autoScrollToggle.dataset.state = replay ? 'replay' : (autoScroll.paused ? 'play' : 'pause');
      autoScrollToggle.setAttribute('aria-label', replay ? 'پخش دوباره روایت از ابتدا' : (autoScroll.paused ? 'ادامه پخش خودکار' : 'توقف موقت پخش خودکار'));
      const icon = $('.auto-scroll-control__icon', autoScrollToggle);
      if (icon) icon.textContent = replay ? '↻' : (autoScroll.paused ? '▶' : 'Ⅱ');
    }
    autoScrollControl?.classList.toggle('is-paused', autoScroll.paused);
    autoScrollControl?.classList.toggle('is-ended', autoScroll.ended);
    const ownsScroll = autoScroll.active && !autoScroll.paused && !autoScroll.ended && !autoScroll.manualOverride;
    body.classList.toggle('auto-scroll-running', ownsScroll);
  }

  function syncAutoScrollTo(y, now = performance.now()) {
    if (!autoScroll.segments.length) buildAutoScrollTimeline();
    const clampedY = clamp(y, 0, maxScrollY());
    let index = autoScroll.segments.findIndex((segment) => clampedY >= segment.startY && clampedY < segment.endY);
    if (index < 0) index = Math.max(0, autoScroll.segments.length - 1);
    const segment = autoScroll.segments[index];
    autoScroll.segmentIndex = index;
    autoScroll.segmentProgress = segment && segment.endY > segment.startY ? clamp((clampedY - segment.startY) / (segment.endY - segment.startY)) : 0;
    autoScroll.lastTime = now;
    window.scrollTo(0, clampedY);
    updateInvitationManualReadiness(clampedY);
  }

  function startAutoScroll({ reset = false, delay = AUTO_SCROLL_CONFIG.initialDelayMs, force = false } = {}) {
    if (autoScroll.manualOverride && !force) return;
    if (force) setManualScrollPhase(false);
    buildAutoScrollTimeline();
    if (!autoScroll.segments.length) return;
    if (reset || autoScroll.ended) syncAutoScrollTo(0);
    else syncAutoScrollTo(window.scrollY);
    autoScroll.active = true;
    autoScroll.paused = false;
    autoScroll.ended = false;
    autoScroll.resumeAt = performance.now() + Math.max(0, delay);
    autoScroll.lastTime = performance.now();
    body.classList.add('auto-scroll-mode');
    updateAutoScrollControls();
  }

  function pauseAutoScroll() {
    if (!autoScroll.active || autoScroll.ended) return;
    autoScroll.paused = true;
    updateAutoScrollControls();
  }

  function resumeAutoScroll() {
    if (autoScroll.ended) {
      startAutoScroll({ reset: true, delay: 700, force: true });
      return;
    }
    autoScroll.active = true;
    autoScroll.paused = false;
    autoScroll.lastTime = performance.now();
    autoScroll.resumeAt = performance.now() + 250;
    updateAutoScrollControls();
  }

  function seekAutoScroll(y) {
    const targetY = clamp(y, 0, maxScrollY());
    if (autoScroll.manualOverride) {
      window.scrollTo({ top: targetY, behavior: reduceMotion ? 'auto' : 'smooth' });
      updateInvitationManualReadiness(targetY);
      return;
    }
    syncAutoScrollTo(targetY);
    autoScroll.ended = false;
    autoScroll.active = true;
    autoScroll.paused = false;
    autoScroll.resumeAt = performance.now() + 450;
    updateAutoScrollControls();
  }

  function stepAutoScroll(now = performance.now()) {
    if (!autoScroll.active || autoScroll.paused || autoScroll.ended) {
      autoScroll.lastTime = now;
      return;
    }
    if (!body.classList.contains('invitation-entered') || body.classList.contains('invitation-opening') || now < autoScroll.resumeAt) {
      autoScroll.lastTime = now;
      return;
    }
    if (!autoScroll.segments.length) buildAutoScrollTimeline();
    const segment = autoScroll.segments[autoScroll.segmentIndex];
    if (!segment) return;

    // Never let the cinematic hero advance before its video has produced a
    // decodable frame. This prevents the opening sequence from being skipped on
    // slow mobile networks. A bounded fallback avoids trapping the visitor if
    // the media request genuinely fails.
    if (segment.kind === 'hero' && !heroReady && now < heroStoryGateUntil) {
      autoScroll.lastTime = now;
      return;
    }

    const dt = Math.min(0.08, Math.max(0, (now - autoScroll.lastTime) / 1000));
    autoScroll.lastTime = now;
    autoScroll.segmentProgress += (dt * currentAutoRate()) / Math.max(0.1, segment.duration);

    while (autoScroll.segmentProgress >= 1) {
      const overflow = autoScroll.segmentProgress - 1;
      window.scrollTo(0, segment.endY);
      if (autoScroll.segmentIndex >= autoScroll.segments.length - 1) {
        autoScroll.segmentProgress = 1;
        autoScroll.active = false;
        autoScroll.ended = true;
        updateAutoScrollControls();
        return;
      }
      autoScroll.segmentIndex += 1;
      const next = autoScroll.segments[autoScroll.segmentIndex];
      autoScroll.segmentProgress = overflow * (segment.duration / Math.max(0.1, next.duration));
    }

    const live = autoScroll.segments[autoScroll.segmentIndex];
    const y = lerp(live.startY, live.endY, clamp(autoScroll.segmentProgress));
    window.scrollTo(0, y);
    updateInvitationManualReadiness(y);
  }

  function blockManualVerticalScroll() {
    const isEditableTarget = () => {
      const tag = document.activeElement?.tagName;
      return ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(tag) || document.activeElement?.isContentEditable;
    };
    const isScrollKey = (key) => ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(key);
    const manualAllowedHere = () => body.classList.contains('invitation-entered') && !body.classList.contains('manual-scroll-accessibility') && isInvitationManualZone();
    const autoOwnsScroll = () => autoScroll.active && !autoScroll.paused && !autoScroll.ended && !autoScroll.manualOverride;
    const shouldBlock = () => body.classList.contains('invitation-entered') && !body.classList.contains('manual-scroll-accessibility') && autoOwnsScroll() && !manualAllowedHere();

    const handOffToManual = () => {
      if (autoScroll.manualOverride || !manualAllowedHere()) return false;
      setManualScrollPhase(true);
      return true;
    };

    window.addEventListener('wheel', (e) => {
      if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if (handOffToManual()) return;
      if (shouldBlock() && e.cancelable) e.preventDefault();
    }, { passive: false, capture: true });

    window.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 1) return;
      if (handOffToManual()) return;
      if (shouldBlock() && e.cancelable) e.preventDefault();
    }, { passive: false, capture: true });

    window.addEventListener('keydown', (e) => {
      if (!isScrollKey(e.key) || isEditableTarget()) return;
      if (handOffToManual()) return;
      if (shouldBlock()) e.preventDefault();
    }, { capture: true });

    window.addEventListener('mousedown', (e) => {
      if (e.button !== 1) return;
      if (handOffToManual()) return;
      if (shouldBlock()) e.preventDefault();
    }, { capture: true });
  }

  function initAutoScroll() {
    buildAutoScrollTimeline();
    blockManualVerticalScroll();
    autoScrollToggle?.addEventListener('click', () => {
      if (autoScroll.ended) resumeAutoScroll();
      else if (autoScroll.paused) resumeAutoScroll();
      else pauseAutoScroll();
    });
    autoScrollSpeed?.addEventListener('click', () => {
      autoScroll.rateIndex = (autoScroll.rateIndex + 1) % AUTO_SCROLL_CONFIG.rates.length;
      updateAutoScrollControls();
    });
    updateAutoScrollControls();
  }

  const BUILD_VERSION = '20260914-cinema-v3-loader';
  const versioned = (path) => `${path}?v=${BUILD_VERSION}`;
  const BOOT_ASSETS = [
    { key: 'logoGold', path: 'assets/mazums-logo-official-gold.svg', type: 'image', bytes: 5959 },
    { key: 'logoIvory', path: 'assets/mazums-logo-official-ivory.svg', type: 'image', bytes: 5959 },
    { key: 'fontRegular', path: 'assets/fonts/IRANSansXFaNum-regular.woff2.woff2', type: 'font', bytes: 29460 },
    { key: 'fontMedium', path: 'assets/fonts/IRANSansXFaNum-medium.woff2.woff2', type: 'font', bytes: 32844 },
    { key: 'fontBold', path: 'assets/fonts/IRANSansXFaNum-bold.woff2.woff2', type: 'font', bytes: 32660 },
    { key: 'heroPoster', path: 'assets/hero-poster.webp', type: 'image', bytes: 196724 },
    { key: 'heroPosterWide', path: 'assets/hero-poster-1600.webp', type: 'image', bytes: 165992 },
    { key: 'campusAerial', path: 'assets/campus-aerial-1600.webp', type: 'image', bytes: 301968 },
    { key: 'campusDrive', path: 'assets/campus-drive-1600.webp', type: 'image', bytes: 431786 },
    { key: 'learning', path: 'assets/learning-1600.webp', type: 'image', bytes: 95544 },
    { key: 'clinical', path: 'assets/clinical-surgery-1600.webp', type: 'image', bytes: 79032 },
    { key: 'graduationGroup', path: 'assets/graduation-group-1600.webp', type: 'image', bytes: 177830 },
    { key: 'graduationPortrait', path: 'assets/graduation-portrait-1600.webp', type: 'image', bytes: 90340 },
    { key: 'finale', path: 'assets/finale-1600.webp', type: 'image', bytes: 226120 },
    { key: 'heroVideo', path: 'assets/hero-scrub-mobile.mp4', type: 'video', bytes: 4740931, keepBlob: true },
    { key: 'ambientAudio', path: 'assets/mazums-elegant-ambient.mp3', type: 'audio', bytes: 1413268, keepBlob: true },
    { key: 'heartbeatAudio', path: 'assets/mazums-heartbeat-72bpm.mp3', type: 'audio', bytes: 160957, keepBlob: true }
  ].map((asset) => ({ ...asset, url: versioned(asset.path), received: 0, complete: false }));

  const BOOT_TOTAL_BYTES = BOOT_ASSETS.reduce((sum, asset) => sum + asset.bytes, 0);
  const bootBlobs = new Map();
  let loaderProgress = 0;
  let loaderCompletedAssets = 0;

  const faNumber = (value) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(value);
  const faDecimal = (value, digits = 1) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
  const formatBytes = (value) => {
    if (!Number.isFinite(value) || value <= 0) return '۰ مگابایت';
    return `${faDecimal(value / (1024 * 1024), value >= 10 * 1024 * 1024 ? 0 : 1)} مگابایت`;
  };

  function setLoader(p) {
    const next = clamp(p);
    loaderProgress = Math.max(loaderProgress, next);
    const v = Math.round(loaderProgress * 100);
    if (loaderTrack) loaderTrack.style.width = `${v}%`;
    if (loaderPercent) loaderPercent.textContent = `${faNumber(v)}٪`;
  }

  function setLoaderStatus(message, detail = '') {
    if (loaderStatus) loaderStatus.textContent = message;
    if (loaderBytes && detail) loaderBytes.textContent = detail;
  }

  function setLoaderStage(name, state = 'active') {
    loaderStages.forEach((el) => {
      if (el.dataset.loaderStage !== name) return;
      el.classList.toggle('is-active', state === 'active');
      el.classList.toggle('is-done', state === 'done');
      el.classList.toggle('is-error', state === 'error');
    });
  }

  function completeLoaderStage(name) {
    setLoaderStage(name, 'done');
  }

  function updateDownloadProgress() {
    const loaded = BOOT_ASSETS.reduce((sum, asset) => sum + Math.min(asset.received, asset.bytes), 0);
    const ratio = BOOT_TOTAL_BYTES ? loaded / BOOT_TOTAL_BYTES : 0;
    setLoader(0.035 + ratio * 0.715);
    if (loaderAssetCount) loaderAssetCount.textContent = `${faNumber(loaderCompletedAssets)} از ${faNumber(BOOT_ASSETS.length)} فایل`;
    if (loaderBytes) loaderBytes.textContent = `${formatBytes(loaded)} از ${formatBytes(BOOT_TOTAL_BYTES)}`;
  }

  function closeLoader() {
    if (loaderClosed) return;
    loaderClosed = true;
    setLoader(1);
    setLoaderStatus('همه‌چیز آماده است؛ ورود به روایت…', `${formatBytes(BOOT_TOTAL_BYTES)} آماده شد`);
    loader?.setAttribute('aria-busy', 'false');
    body.classList.remove('is-loading');
    body.classList.add('is-ready');
    loader?.classList.add('is-hidden');
    setTimeout(() => loader?.remove(), 900);
  }

  function showLoaderFailure(error) {
    console.error('[MAZUMS] Strict bootstrap failed', error);
    body.classList.add('is-loading');
    body.classList.remove('is-ready');
    loader?.classList.remove('is-hidden');
    loader?.setAttribute('aria-busy', 'false');
    loaderStages.forEach((stage) => {
      if (stage.classList.contains('is-active')) {
        stage.classList.remove('is-active');
        stage.classList.add('is-error');
      }
    });
    setLoaderStatus('آماده‌سازی متوقف شد؛ هیچ بخش ناقصی نمایش داده نمی‌شود.');
    if (loaderErrorText) {
      const offline = navigator.onLine === false;
      loaderErrorText.textContent = offline
        ? 'اتصال اینترنت قطع است. پس از برقراری اتصال، دوباره تلاش کنید.'
        : 'یکی از فایل‌های ضروری یا موتور پخش به‌درستی آماده نشد. برای حفظ کیفیت تجربه، ورود متوقف شده است.';
    }
    if (loaderError) loaderError.hidden = false;
  }

  loaderRetry?.addEventListener('click', () => location.reload());
  window.addEventListener('online', () => {
    if (!loaderClosed && loaderError && !loaderError.hidden && loaderErrorText) {
      loaderErrorText.textContent = 'اتصال برقرار شد. برای بررسی دوباره، «تلاش دوباره» را بزنید.';
    }
  });

  async function fetchAssetStrict(asset) {
    const response = await fetch(asset.url, { cache: 'force-cache', credentials: 'same-origin' });
    if (!response.ok) throw new Error(`Asset request failed (${response.status}): ${asset.path}`);

    const chunks = [];
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          received += value.byteLength;
          if (asset.keepBlob) chunks.push(value);
          asset.received = Math.min(asset.bytes, received);
          updateDownloadProgress();
        }
      }
      if (received <= 0) throw new Error(`Empty asset: ${asset.path}`);
      if (asset.keepBlob) bootBlobs.set(asset.key, new Blob(chunks, { type: response.headers.get('content-type') || '' }));
    } else {
      const blob = await response.blob();
      if (!blob.size) throw new Error(`Empty asset: ${asset.path}`);
      if (asset.keepBlob) bootBlobs.set(asset.key, blob);
    }

    asset.received = asset.bytes;
    asset.complete = true;
    loaderCompletedAssets += 1;
    updateDownloadProgress();
    return true;
  }

  async function mapLimit(items, limit, worker) {
    let index = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (index < items.length) {
        const current = items[index++];
        await worker(current);
      }
    });
    await Promise.all(runners);
  }

  async function downloadAllRequiredAssets() {
    setLoaderStage('download', 'active');
    setLoaderStatus('در حال دریافت کامل فایل‌های موردنیاز…', `۰ از ${formatBytes(BOOT_TOTAL_BYTES)}`);
    updateDownloadProgress();

    // Four concurrent streams are fast enough on broadband while avoiding a
    // thundering herd on mobile networks. Large media begins immediately.
    const ordered = [
      BOOT_ASSETS.find((a) => a.key === 'heroVideo'),
      BOOT_ASSETS.find((a) => a.key === 'heroPoster'),
      ...BOOT_ASSETS.filter((a) => !['heroVideo', 'heroPoster'].includes(a.key))
    ].filter(Boolean);
    await mapLimit(ordered, 4, fetchAssetStrict);

    if (!BOOT_ASSETS.every((asset) => asset.complete)) throw new Error('Not every required asset completed');
    completeLoaderStage('download');
    setLoader(0.75);
  }

  function preloadImageStrict(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.loading = 'eager';
      img.onload = async () => {
        try {
          if (!img.naturalWidth || !img.naturalHeight) throw new Error(`Image has invalid dimensions: ${url}`);
          if (img.decode && !/\.svg(?:\?|$)/i.test(url)) await img.decode();
          resolve(true);
        } catch (error) { reject(error); }
      };
      img.onerror = () => reject(new Error(`Image decode failed: ${url}`));
      img.src = url;
    });
  }

  async function verifyVisualAssetsAndFonts() {
    setLoaderStage('visual', 'active');
    setLoaderStatus('در حال decode تصاویر و آماده‌سازی تایپوگرافی…');
    const images = BOOT_ASSETS.filter((asset) => asset.type === 'image');
    await Promise.all(images.map((asset) => preloadImageStrict(asset.url)));
    setLoader(0.82);

    if (document.fonts) {
      await Promise.all([
        document.fonts.load('400 16px IRANSansX'),
        document.fonts.load('500 16px IRANSansX'),
        document.fonts.load('700 16px IRANSansX')
      ]);
      await document.fonts.ready;
      if (!document.fonts.check('400 16px IRANSansX') || !document.fonts.check('700 16px IRANSansX')) {
        throw new Error('IRANSansX fonts did not become ready');
      }
    }
    completeLoaderStage('visual');
    setLoader(0.86);
  }

  function waitForMediaReady(element, label, timeoutMs = 12000) {
    return new Promise((resolve, reject) => {
      if (!element) return reject(new Error(`${label} element missing`));
      if (element.readyState >= 2 && Number.isFinite(element.duration) && element.duration > 0) return resolve(true);
      let timer = 0;
      const cleanup = () => {
        clearTimeout(timer);
        element.removeEventListener('canplay', ready);
        element.removeEventListener('loadeddata', ready);
        element.removeEventListener('error', failed);
      };
      const ready = () => {
        if (element.readyState < 2) return;
        cleanup();
        resolve(true);
      };
      const failed = () => {
        cleanup();
        reject(new Error(`${label} could not be decoded`));
      };
      element.addEventListener('canplay', ready);
      element.addEventListener('loadeddata', ready);
      element.addEventListener('error', failed);
      timer = setTimeout(() => {
        cleanup();
        reject(new Error(`${label} decode timed out`));
      }, timeoutMs);
    });
  }

  function waitForSeek(element, target, timeoutMs = 7000) {
    return new Promise((resolve, reject) => {
      let timer = 0;
      const cleanup = () => {
        clearTimeout(timer);
        element.removeEventListener('seeked', done);
        element.removeEventListener('error', failed);
      };
      const done = () => { cleanup(); resolve(true); };
      const failed = () => { cleanup(); reject(new Error('Video seek failed')); };
      element.addEventListener('seeked', done, { once: true });
      element.addEventListener('error', failed, { once: true });
      timer = setTimeout(() => { cleanup(); reject(new Error('Video seek verification timed out')); }, timeoutMs);
      try { element.currentTime = target; } catch (error) { cleanup(); reject(error); }
    });
  }

  function heroVideoSource() {
    return heroVideo?.dataset.src || heroVideo?.getAttribute('src') || versioned('assets/hero-scrub-mobile.mp4');
  }

  async function preloadHeroVideoBlob() {
    if (preloadedVideoURL) return preloadedVideoURL;
    const blob = bootBlobs.get('heroVideo');
    if (!blob || blob.size < 256 * 1024) return null;
    preloadedVideoURL = URL.createObjectURL(blob);
    return preloadedVideoURL;
  }

  const withTimeout = (promise, ms) => Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(false), ms))
  ]);

  function bindVideoSource({ preferBlob = false } = {}) {
    if (heroVideoLoadPromise && !preferBlob) return heroVideoLoadPromise;

    heroVideoLoadPromise = new Promise((resolve) => {
      let settled = false;
      const fallbackSrc = heroVideoSource();
      const desiredSrc = preferBlob && preloadedVideoURL ? preloadedVideoURL : fallbackSrc;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        heroReady = !!ok;
        heroVideoFailed = !ok;
        try { heroVideo.pause(); } catch {}
        if (ok) {
          try { heroVideo.currentTime = 0; } catch {}
          displayedFrame = 0;
          targetFrame = 0;
          lastAppliedFrame = -1;
        }
        updateAutoScrollControls();
        resolve(!!ok);
      };

      heroVideo.muted = true;
      heroVideo.playsInline = true;
      heroVideo.setAttribute('playsinline', '');
      heroVideo.setAttribute('webkit-playsinline', '');
      heroVideo.preload = 'auto';

      const current = heroVideo.currentSrc || heroVideo.getAttribute('src') || '';
      if (!current || (preferBlob && preloadedVideoURL && !current.startsWith('blob:'))) {
        heroVideo.src = desiredSrc;
        try { heroVideo.load(); } catch {}
      }

      const onReady = () => finish(true);
      const onError = () => finish(false);
      heroVideo.addEventListener('loadeddata', onReady, { once: true });
      heroVideo.addEventListener('canplay', onReady, { once: true });
      heroVideo.addEventListener('error', onError, { once: true });
      setTimeout(() => finish(heroVideo.readyState >= 2), 10000);
      if (heroVideo.readyState >= 2) finish(true);
    });
    return heroVideoLoadPromise;
  }

  async function ensureHeroVideoReadyForStory(maxWaitMs = 5000) {
    if (reduceMotion || heroReady) return true;

    heroStoryGateUntil = performance.now() + Math.max(2500, maxWaitMs + 3500);

    // Give the native preload a chance first. It starts at parse time and is the
    // fastest route on mobile browsers.
    const nativeReady = await withTimeout(bindVideoSource(), Math.min(2200, maxWaitMs));
    if (nativeReady || heroReady) return true;

    // Wait for the complete background fetch within the remaining entrance
    // budget. If it finishes, switch to a local Blob: every scrub frame is then
    // available without further network seeks.
    const blobBudget = Math.max(900, maxWaitMs - 2200);
    const blobURL = await withTimeout(heroBlobWarmPromise || preloadHeroVideoBlob(), blobBudget);
    if (blobURL || preloadedVideoURL) {
      heroVideoLoadPromise = null;
      heroVideoFailed = false;
      const blobReady = await withTimeout(bindVideoSource({ preferBlob: true }), 1400);
      if (blobReady || heroReady) return true;
    }

    // Last retry of the native source. The story gate in stepAutoScroll keeps the
    // opening section stationary while this is still loading, but will release
    // automatically after a bounded timeout if the media is genuinely unavailable.
    heroVideoFailed = false;
    heroVideoLoadPromise = null;
    try {
      heroVideo.src = heroVideoSource();
      heroVideo.load();
    } catch {}
    return !!(await withTimeout(bindVideoSource(), Math.max(900, maxWaitMs - 2200)));
  }


  async function verifyMediaAssets() {
    setLoaderStage('media', 'active');
    setLoaderStatus('در حال آماده‌سازی و بررسی ویدیو و صدا…');

    if (!heroVideo?.canPlayType?.('video/mp4')) throw new Error('This browser cannot play the required MP4 video');
    if (!backgroundMusic?.canPlayType?.('audio/mpeg') || !heartbeatAudio?.canPlayType?.('audio/mpeg')) {
      throw new Error('This browser cannot play the required MP3 audio');
    }

    const videoBlob = bootBlobs.get('heroVideo');
    const ambientBlob = bootBlobs.get('ambientAudio');
    const heartbeatBlob = bootBlobs.get('heartbeatAudio');
    if (!videoBlob || !ambientBlob || !heartbeatBlob) throw new Error('Required media blobs are missing');

    preloadedVideoURL = preloadedVideoURL || URL.createObjectURL(videoBlob);
    heroBlobWarmPromise = Promise.resolve(preloadedVideoURL);
    heroVideoLoadPromise = null;
    heroVideoFailed = false;
    const videoReady = await bindVideoSource({ preferBlob: true });
    if (!videoReady || !heroReady) throw new Error('Hero video could not reach a decodable state');
    await waitForMediaReady(heroVideo, 'Hero video');
    setLoader(0.895);

    // A real seek probe catches files that can load their first frame but fail
    // once the scroll-driven film tries to jump through the timeline.
    if (!Number.isFinite(heroVideo.duration) || heroVideo.duration <= 1) throw new Error('Hero video duration is invalid');
    const probeTime = Math.min(Math.max(heroVideo.duration * 0.52, 0.25), Math.max(0.25, heroVideo.duration - 0.12));
    await waitForSeek(heroVideo, probeTime);
    await waitForSeek(heroVideo, 0);
    try { heroVideo.pause(); } catch {}
    displayedFrame = 0;
    targetFrame = 0;
    lastAppliedFrame = -1;
    setLoader(0.915);

    backgroundMusicBlobURL = URL.createObjectURL(ambientBlob);
    heartbeatBlobURL = URL.createObjectURL(heartbeatBlob);
    backgroundMusic.src = backgroundMusicBlobURL;
    heartbeatAudio.src = heartbeatBlobURL;
    backgroundMusic.preload = 'auto';
    heartbeatAudio.preload = 'auto';
    backgroundMusic.load();
    heartbeatAudio.load();
    await Promise.all([
      waitForMediaReady(backgroundMusic, 'Ambient audio'),
      waitForMediaReady(heartbeatAudio, 'Heartbeat audio')
    ]);
    if (!Number.isFinite(backgroundMusic.duration) || backgroundMusic.duration <= 1) throw new Error('Ambient audio duration is invalid');
    if (!Number.isFinite(heartbeatAudio.duration) || heartbeatAudio.duration <= 1) throw new Error('Heartbeat audio duration is invalid');

    completeLoaderStage('media');
    setLoader(0.94);
  }

  function waitForWindowComplete() {
    if (document.readyState === 'complete') return Promise.resolve();
    return new Promise((resolve) => window.addEventListener('load', resolve, { once: true }));
  }

  async function verifyRuntimeEngine() {
    setLoaderStage('engine', 'active');
    setLoaderStatus('در حال بررسی نهایی صحنه و موتور سه‌بعدی…');

    const requiredNodes = [heroSection, heroVideo, filmCard, mailIntro, mailStage, mailEnvelope, mailCard, mailSeal, finaleSection, depthCanvas, confettiCanvas];
    if (requiredNodes.some((node) => !node)) throw new Error('A required cinematic DOM node is missing');
    if (sections.length !== 5) throw new Error(`Expected 5 story chapters, found ${sections.length}`);
    if (!depthCanvas.getContext('2d') || !confettiCanvas.getContext('2d')) throw new Error('2D canvas engine is unavailable');
    if (!heroReady || heroVideo.readyState < 2) throw new Error('Hero video lost readiness before runtime start');

    await waitForWindowComplete();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const loaderStyle = getComputedStyle(loader);
    const bodyStyle = getComputedStyle(body);
    if (loaderStyle.position !== 'fixed' || loaderStyle.display === 'none') throw new Error('Loader stylesheet was not applied correctly');
    if (!bodyStyle.fontFamily.toLowerCase().includes('iransansx')) throw new Error('Primary typography stylesheet is not active');
    if (bodyStyle.overflowX !== 'hidden') throw new Error('Horizontal overflow guard is not active');

    completeLoaderStage('engine');
    setLoader(0.985);
    setLoaderStatus('همه اجزا با موفقیت بررسی شدند؛ آماده ورود…');
  }

  function computeMetrics() {
    viewportH = innerHeight;
    viewportW = innerWidth;
    chapterMetrics = sections.map((section) => ({
      el: section,
      top: section.offsetTop,
      span: Math.max(1, section.offsetHeight - viewportH),
      chapter: Number(section.dataset.chapter || 0)
    }));
    resizeCanvases();
  }

  function heroProgressFromScroll(y) {
    const span = Math.max(1, heroSection.offsetHeight - viewportH);
    return clamp((y - heroSection.offsetTop) / span);
  }

  function applyHeroFrame() {
    if (!heroReady || reduceMotion) return;
    targetFrame = Math.round(targetHeroP * (TOTAL_FRAMES - 1));
    const diff = targetFrame - displayedFrame;
    if (Math.abs(diff) >= 0.5) {
      const maxStep = mobile ? 2.3 : 3.8;
      displayedFrame += Math.sign(diff) * Math.min(Math.abs(diff), maxStep);
    } else {
      displayedFrame = targetFrame;
    }
    const frame = clamp(Math.round(displayedFrame), 0, TOTAL_FRAMES - 1);
    if (frame !== lastAppliedFrame && heroVideo.readyState >= 1) {
      const safeDuration = Math.max((heroVideo.duration || (TOTAL_FRAMES / FPS)) - 0.04, 0);
      const time = Math.min(frame / FPS, safeDuration);
      try {
        heroVideo.pause();
        heroVideo.currentTime = time;
      } catch {}
      lastAppliedFrame = frame;
      if (frameReadout) frameReadout.textContent = `FRAME ${String(frame).padStart(3, '0')} / ${TOTAL_FRAMES - 1}`;
      const seconds = frame / FPS;
      const s = Math.floor(seconds);
      const ff = frame % FPS;
      if (heroTimecode) heroTimecode.textContent = `00:${String(s).padStart(2, '0')}:${String(ff).padStart(2, '0')}`;
    }
  }

  function updateCinematicLook() {
    lookFrame = (lookFrame + 1) % (mobile ? 4 : 2);
    if (lookFrame !== 0 && lastLook.x !== 99) return;
    const root = document.documentElement.style;
    const x = reduceMotion ? 0 : pointer.sx;
    const y = reduceMotion ? 0 : pointer.sy;
    if (Math.abs(x - lastLook.x) < .0035 && Math.abs(y - lastLook.y) < .0035) return;
    lastLook = { x, y };
    root.setProperty('--look-x', x.toFixed(4));
    root.setProperty('--look-y', y.toFixed(4));
    root.setProperty('--lx4p', `${(x * 4).toFixed(3)}%`);
    root.setProperty('--ly3p', `${(y * 3).toFixed(3)}%`);
    root.setProperty('--lxN3p', `${(-x * 3).toFixed(3)}%`);
    root.setProperty('--lx9px', `${(x * 9).toFixed(2)}px`);
    root.setProperty('--ly5px', `${(y * 5).toFixed(2)}px`);
    root.setProperty('--lxN7px', `${(-x * 7).toFixed(2)}px`);
    root.setProperty('--lyN4px', `${(-y * 4).toFixed(2)}px`);
    root.setProperty('--lyN5px', `${(-y * 5).toFixed(2)}px`);
    root.setProperty('--lx17vw', `${(x * 1.7).toFixed(3)}vw`);
    root.setProperty('--ly12vw', `${(y * 1.2).toFixed(3)}vw`);
    root.setProperty('--lx1vw', `${x.toFixed(3)}vw`);
    root.setProperty('--lyN12deg', `${(-y * 1.2).toFixed(3)}deg`);
    root.setProperty('--lx15deg', `${(x * 1.5).toFixed(3)}deg`);
    root.setProperty('--lx035deg', `${(x * .35).toFixed(3)}deg`);
    root.setProperty('--lx12px', `${(x * 12).toFixed(2)}px`);
    root.setProperty('--ly8px', `${(y * 8).toFixed(2)}px`);
    root.setProperty('--lxN16px', `${(-x * 16).toFixed(2)}px`);
    root.setProperty('--lyN9px', `${(-y * 9).toFixed(2)}px`);
    root.setProperty('--lx8px', `${(x * 8).toFixed(2)}px`);
    root.setProperty('--lxN5px', `${(-x * 5).toFixed(2)}px`);
    root.setProperty('--lyN3px', `${(-y * 3).toFixed(2)}px`);
  }

  function updateHeroUI(p) {
    heroProgressEl.style.width = `${p * 100}%`;
    heroScenes.forEach((scene, i) => {
      const start = Number(scene.dataset.start || 0);
      const end = Number(scene.dataset.end || 1);
      const alpha = reduceMotion ? (i === 0 ? 1 : 0) : fadeWindow(p, start, end, 0.075);
      const local = clamp((p - start) / Math.max(1e-6, end - start));
      const y = (0.5 - local) * (mobile ? 20 : 44);
      const blur = (1 - alpha) * (mobile ? 7 : 11);
      scene.style.opacity = alpha.toFixed(3);
      scene.style.filter = `blur(${blur.toFixed(2)}px)`;
      scene.style.transform = innerWidth > 820
        ? `translate3d(0, calc(-50% + ${y}px), 0)`
        : `translate3d(0, ${y}px, 0)`;
      scene.classList.toggle('is-live', alpha > 0.5);
    });

    const tiltX = pointer.sy * (mobile ? 0.55 : 2.8) + scrollVelocity * (mobile ? 0.001 : 0.004);
    const tiltY = pointer.sx * (mobile ? 0.8 : 4.2);
    const z = Math.sin(p * Math.PI) * (mobile ? 14 : 64);
    const roll = (p - 0.5) * (mobile ? 0.5 : 1.15);
    const breathing = 1 + Math.sin(p * Math.PI) * (mobile ? .008 : .022);
    const filmTranslateY = mobile ? '-58%' : '-50%';
    const lookX = pointer.sx * (mobile ? 2 : 9);
    const lookY = pointer.sy * (mobile ? 1.5 : 6);
    filmCard.style.transform = `translate(calc(-50% + ${lookX.toFixed(2)}px),calc(${filmTranslateY} + ${lookY.toFixed(2)}px)) perspective(1800px) translateZ(${z.toFixed(2)}px) rotateX(${tiltX.toFixed(3)}deg) rotateY(${(tiltY - 2.2).toFixed(3)}deg) rotateZ(${roll.toFixed(3)}deg) scale(${breathing.toFixed(4)})`;
    if (heroVolume) {
      const vz = -34 + Math.sin(p * Math.PI) * 34;
      heroVolume.style.transform = `translate3d(-50%,-50%,${vz.toFixed(2)}px) rotateX(${(-pointer.sy * (mobile ? .7 : 2.2)).toFixed(3)}deg) rotateY(${(pointer.sx * (mobile ? .9 : 3.2)).toFixed(3)}deg) rotateZ(${((p - .5) * (mobile ? .5 : 1.2)).toFixed(3)}deg)`;
    }
    const shine = $('.film-card__shine');
    if (shine) shine.style.transform = `translateX(${(-135 + p * 270 + pointer.sx * 9).toFixed(1)}%)`;
  }

  function chapterProgress(metric, y) {
    return clamp((y - metric.top) / metric.span);
  }

  function updateInviteMotion(sectionRect) {
    if (!inviteStage || !inviteCard) return;
    const sectionVisible = clamp(1 - Math.abs(sectionRect.top + sectionRect.height * 0.5 - viewportH * 0.55) / viewportH, 0, 1);
    const tiltX = (-pointer.sy * (mobile ? 3.2 : 9.5)) * sectionVisible;
    const tiltY = (pointer.sx * (mobile ? 4.8 : 14.5)) * sectionVisible;
    const z = (mobile ? 16 : 46) * sectionVisible;
    const driftX = pointer.sx * (mobile ? 2 : 9) * sectionVisible;
    const driftY = pointer.sy * (mobile ? 1.5 : 6) * sectionVisible;
    inviteStage.style.transform = `perspective(1900px) translate3d(${driftX.toFixed(2)}px,${driftY.toFixed(2)}px,${z.toFixed(2)}px) rotateX(${tiltX.toFixed(3)}deg) rotateY(${tiltY.toFixed(3)}deg)`;
    inviteCard.style.transform = `translateZ(${(mobile ? 24 : 48) + z * 0.55}px)`;
    const shine = $('.invite-card__shine', inviteCard);
    if (shine) shine.style.transform = `translateX(${(-55 + (pointer.sx + 1) * 34).toFixed(1)}%) rotate(2deg)`;
  }

  function updateChapterNavigation(index) {
    storyLinks.forEach((link) => {
      const active = Number(link.dataset.storyIndex || 0) === index;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'step');
      else link.removeAttribute('aria-current');
    });
    topbarNavLinks.forEach((link) => {
      const target = link.getAttribute('href')?.replace('#', '');
      const targetEl = target ? document.getElementById(target) : null;
      const active = Number(targetEl?.dataset?.chapter || 0) === index;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  function updateChapters(y) {
    let best = { idx: 0, dist: Infinity };
    let heartbeatWanted = false;

    chapterMetrics.forEach((metric) => {
      const p = chapterProgress(metric, y);
      const localCenter = Math.abs(p - 0.5);
      const inRange = y >= metric.top - viewportH * 0.45 && y <= metric.top + metric.span + viewportH * 0.45;
      if (inRange && localCenter < best.dist) best = { idx: metric.chapter, dist: localCenter };

      if (metric.el.classList.contains('chapter')) {
        const contentA = fadeWindow(p, 0.1, 0.92, 0.14);
        const contentY = lerp(42, -26, p);
        const bgScale = lerp(1.12, 1.025, p);
        const bgX = (p - 0.5) * (mobile ? 1.2 : 2.8);
        const bgY = (p - 0.5) * (mobile ? -1.6 : -3.2);
        const numX = (p - 0.5) * (mobile ? 18 : 56);
        metric.el.style.setProperty('--content-alpha', contentA.toFixed(3));
        metric.el.style.setProperty('--content-y', `${contentY.toFixed(1)}px`);
        metric.el.style.setProperty('--content-blur', `${((1 - contentA) * 7).toFixed(1)}px`);
        metric.el.style.setProperty('--bg-scale', bgScale.toFixed(4));
        metric.el.style.setProperty('--bg-x', `${bgX.toFixed(2)}%`);
        metric.el.style.setProperty('--bg-y', `${bgY.toFixed(2)}%`);
        metric.el.style.setProperty('--num-x', `${numX.toFixed(1)}px`);
        metric.el.style.setProperty('--card-alpha', fadeWindow(p, 0.22, 0.86, 0.12).toFixed(3));
        const cameraWeight = fadeWindow(p, 0.04, 0.96, 0.12);
        const camRx = (pointer.sy * (mobile ? -.12 : -.7) + (p - .5) * (mobile ? .08 : .32)) * cameraWeight;
        const camRy = (pointer.sx * (mobile ? .16 : .9)) * cameraWeight;
        metric.el.style.setProperty('--cam-rx', `${camRx.toFixed(3)}deg`);
        metric.el.style.setProperty('--cam-ry', `${camRy.toFixed(3)}deg`);
        metric.el.style.setProperty('--atmos-alpha', `${(.16 + cameraWeight * (mobile ? .34 : .62)).toFixed(3)}`);

        const content = $('.chapter__content', metric.el);
        if (content) {
          const ty = innerWidth > 820 ? `calc(-50% + ${contentY.toFixed(1)}px)` : `${contentY.toFixed(1)}px`;
          const contentZ = mobile ? 8 : 34 + Math.sin(p * Math.PI) * 24;
          const contentX = pointer.sx * (mobile ? .7 : 4.5) * fadeWindow(p, .06, .96, .14);
          content.style.transform = `translate3d(${contentX.toFixed(2)}px, ${ty}, ${contentZ.toFixed(2)}px)`;
        }

        if (metric.el.classList.contains('chapter--campus')) {
          metric.el.style.setProperty('--steth-dash', `${(1500 * (1 - smoothstep(0.12, 0.62, p))).toFixed(0)}`);
          metric.el.style.setProperty('--steth-alpha', `${0.06 + smoothstep(0.18, 0.64, p) * 0.34}`);
          metric.el.style.setProperty('--steth-x', `${lerp(62, -18, p)}px`);
          metric.el.style.setProperty('--steth-y', `${lerp(-18, 44, p)}px`);
        }

        if (metric.el.classList.contains('chapter--learning')) {
          metric.el.style.setProperty('--helix-alpha', `${fadeWindow(p, 0.12, 0.92, 0.18) * 0.92}`);
          drawHelix(p);
        }

        if (metric.el.classList.contains('chapter--clinical')) {
          const a = fadeWindow(p, 0.16, 0.88, 0.12);
          metric.el.style.setProperty('--monitor-alpha', a.toFixed(3));
          metric.el.style.setProperty('--monitor-y', `${lerp(-28, 18, p)}px`);
          metric.el.style.setProperty('--ecg-dash', `${(1100 * (1 - smoothstep(0.18, 0.72, p))).toFixed(0)}`);
          metric.el.style.setProperty('--beam-alpha', `${0.08 + a * 0.38}`);
          const monitor = $('.monitor', metric.el);
          if (monitor) {
            const mrx = -pointer.sy * (mobile ? .8 : 3.4) * a;
            const mry = pointer.sx * (mobile ? 1.1 : 5.2) * a;
            monitor.style.transform = `translate3d(${(pointer.sx * (mobile ? 1 : 5) * a).toFixed(2)}px,${lerp(-28, 18, p).toFixed(2)}px,${(a * (mobile ? 10 : 42)).toFixed(2)}px) rotateX(${mrx.toFixed(2)}deg) rotateY(${mry.toFixed(2)}deg)`;
          }
          heartbeatWanted = a > 0.12;
        }

        if (metric.el.classList.contains('chapter--graduation')) {
          drawConfetti(p, fadeWindow(p, 0.26, 0.94, 0.14));
        }

        $$('[data-tilt]', metric.el).forEach((card, i) => {
          const a = fadeWindow(p, 0.18, 0.88, 0.15);
          const ry = (pointer.sx * (mobile ? 2.8 : 9.5)) + (p - 0.5) * (i ? 5 : -5);
          const rx = (-pointer.sy * (mobile ? 2.1 : 6.5)) + (0.5 - p) * 2;
          const ty = (0.5 - p) * (mobile ? 26 : 58);
          const tx = pointer.sx * (mobile ? 1.3 : 7) * a;
          card.style.transform = `translate3d(${tx.toFixed(2)}px,${ty.toFixed(2)}px,${(a * (mobile ? 24 : 62)).toFixed(2)}px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) rotateZ(${i ? 1.5 : -1.6}deg)`;
        });
      }

      if (metric.el.classList.contains('finale')) {
        updateInviteMotion(metric.el.getBoundingClientRect());
      }
    });

    let cut = 0;
    if (!reduceMotion) {
      for (const metric of chapterMetrics) {
        const raw = (y - metric.top) / Math.max(1, metric.span);
        if (raw >= 0 && raw <= 1) {
          const edge = Math.min(raw, 1 - raw);
          cut = Math.max(cut, (1 - smoothstep(0, .075, edge)) * (mobile ? .18 : .34));
        }
      }
    }
    document.documentElement.style.setProperty('--cinema-cut', cut.toFixed(3));
    setHeartbeatWanted(heartbeatWanted);
    if (best.idx !== activeChapter) {
      activeChapter = best.idx;
      updateChapterNavigation(activeChapter);
    }
    railIndex.textContent = String(activeChapter).padStart(2, '0');
    const docMax = Math.max(1, document.documentElement.scrollHeight - viewportH);
    railFill.style.height = `${clamp(y / docMax) * 100}%`;
  }

  const dctx = depthCanvas.getContext('2d');
  const particleCount = lowPower ? 90 : (mobile ? 180 : 340);
  const particles = Array.from({ length: particleCount }, () => ({
    x: Math.random() * 2 - 1,
    y: Math.random() * 2 - 1,
    z: Math.random(),
    size: 0.35 + Math.random() * 1.45,
    tone: Math.random()
  }));

  function resizeCanvas(canvas, ctx, dprCap = 1.5) {
    const dpr = Math.min(devicePixelRatio || 1, dprCap);
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
    canvas.style.width = `${innerWidth}px`;
    canvas.style.height = `${innerHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function resizeCanvases() {
    resizeCanvas(depthCanvas, dctx, mobile ? 1.1 : 1.5);
    resizeCanvas(confettiCanvas, confettiCanvas.getContext('2d'), mobile ? 1 : 1.35);
    if (helixCanvas) resizeCanvas(helixCanvas, helixCanvas.getContext('2d'), mobile ? 1 : 1.25);
  }

  function drawDepth() {
    dctx.clearRect(0, 0, viewportW, viewportH);
    const heroA = 1 - smoothstep(0.94, 1, targetHeroP);
    const amount = mobile ? 0.54 : 0.8;
    const cx = viewportW * (0.5 + pointer.sx * 0.03);
    const cy = viewportH * (0.48 + pointer.sy * 0.022);
    const speedBias = Math.min(1, Math.abs(scrollVelocity) / 75);
    for (const p of particles) {
      const z = ((p.z + scrollY * 0.00005) % 1 + 1) % 1;
      const depth = 0.2 + z * 1.1;
      const x = cx + p.x * viewportW * depth * 0.64;
      const y = cy + p.y * viewportH * depth * 0.55;
      if (x < -20 || x > viewportW + 20 || y < -20 || y > viewportH + 20) continue;
      const a = (0.04 + z * 0.2) * amount * (0.75 + heroA * 0.25);
      const r = p.size * (0.42 + z * 1.45 + speedBias * 0.26);
      dctx.beginPath();
      dctx.arc(x, y, r, 0, Math.PI * 2);
      dctx.fillStyle = p.tone > 0.84 ? `rgba(201,169,97,${a})` : `rgba(207,230,232,${a * 0.68})`;
      dctx.fill();
    }
  }

  const hctx = helixCanvas?.getContext('2d');
  function drawHelix(p) {
    if (!helixCanvas || !hctx) return;
    const w = helixCanvas.clientWidth || 400;
    const h = helixCanvas.clientHeight || 500;
    hctx.clearRect(0, 0, w, h);
    const cx = w * 0.5;
    const radius = Math.min(w, h) * 0.19;
    const span = h * 0.86;
    const points = 40;
    const phase = p * Math.PI * 3.1;
    for (let i = 0; i < points; i += 1) {
      const t = i / (points - 1);
      const y = h * 0.07 + t * span;
      const a = phase + t * Math.PI * 5.5;
      const z1 = Math.sin(a);
      const z2 = Math.sin(a + Math.PI);
      const x1 = cx + Math.cos(a) * radius;
      const x2 = cx + Math.cos(a + Math.PI) * radius;
      if (i % 3 === 0) {
        hctx.beginPath();
        hctx.moveTo(x1, y);
        hctx.lineTo(x2, y);
        hctx.strokeStyle = 'rgba(213,233,235,.14)';
        hctx.lineWidth = 1;
        hctx.stroke();
      }
      [[x1, z1], [x2, z2]].forEach(([x, z], j) => {
        const r = 2.2 + (z + 1) * 2.1;
        const alpha = 0.22 + (z + 1) * 0.22;
        hctx.beginPath();
        hctx.arc(x, y, r, 0, Math.PI * 2);
        hctx.fillStyle = (i + j) % 5 === 0 ? `rgba(230,207,145,${alpha})` : `rgba(138,184,194,${alpha})`;
        hctx.shadowBlur = 10;
        hctx.shadowColor = hctx.fillStyle;
        hctx.fill();
        hctx.shadowBlur = 0;
      });
    }
  }

  const cctx = confettiCanvas.getContext('2d');
  const confetti = Array.from({ length: lowPower ? 55 : (mobile ? 100 : 165) }, (_, i) => ({
    x: Math.random(),
    y: Math.random() * -0.7,
    speed: 0.42 + Math.random() * 1.05,
    drift: (Math.random() - 0.5) * 0.22,
    rot: Math.random() * Math.PI * 2,
    spin: (Math.random() - 0.5) * 9,
    size: 4 + Math.random() * 8,
    gold: i % 4 === 0
  }));

  function drawConfetti(p, alpha) {
    cctx.clearRect(0, 0, viewportW, viewportH);
    if (alpha <= 0.005) return;
    const q = smoothstep(0.22, 0.88, p);
    for (const c of confetti) {
      const x = (c.x + c.drift * q + Math.sin((q + c.rot) * 5) * 0.018) * viewportW;
      const y = (c.y + q * c.speed * 1.75) * viewportH;
      if (y < -40 || y > viewportH + 40) continue;
      const rot = c.rot + q * c.spin;
      cctx.save();
      cctx.translate(x, y);
      cctx.rotate(rot);
      cctx.globalAlpha = alpha * 0.8;
      cctx.fillStyle = c.gold ? '#d9bb72' : '#d8d4ca';
      cctx.fillRect(-c.size * 0.5, -c.size * 0.26, c.size, c.size * 0.52);
      cctx.restore();
    }
  }

  const audio = { on: false, userMuted: false, heartbeatWanted: false, heartbeatPlaying: false, autoplayBlocked: false };
  const volumeAnimations = new WeakMap();
  if (backgroundMusic) backgroundMusic.volume = 0.23;
  if (heartbeatAudio) heartbeatAudio.volume = 0;

  function rampVolume(el, to, duration = 420) {
    if (!el) return;
    const previous = volumeAnimations.get(el);
    if (previous) cancelAnimationFrame(previous.raf);
    const from = el.volume;
    const started = performance.now();
    const state = { raf: 0 };
    const tick = (now) => {
      const p = clamp((now - started) / Math.max(1, duration));
      const eased = p * p * (3 - 2 * p);
      el.volume = clamp(lerp(from, to, eased), 0, 1);
      if (p < 1) state.raf = requestAnimationFrame(tick);
      else volumeAnimations.delete(el);
    };
    state.raf = requestAnimationFrame(tick);
    volumeAnimations.set(el, state);
  }

  async function startHeartbeat() {
    if (!heartbeatAudio || !audio.on || !audio.heartbeatWanted || audio.heartbeatPlaying) return;
    audio.heartbeatPlaying = true;
    try {
      heartbeatAudio.currentTime = 0;
      heartbeatAudio.volume = 0;
      await heartbeatAudio.play();
      rampVolume(backgroundMusic, 0.16, 520);
      rampVolume(heartbeatAudio, 0.38, 560);
    } catch {
      audio.heartbeatPlaying = false;
    }
  }

  function stopHeartbeat() {
    if (!heartbeatAudio || !audio.heartbeatPlaying) {
      if (audio.on) rampVolume(backgroundMusic, 0.23, 520);
      return;
    }
    audio.heartbeatPlaying = false;
    rampVolume(backgroundMusic, 0.23, 560);
    const was = heartbeatAudio;
    rampVolume(was, 0, 480);
    setTimeout(() => {
      if (!audio.heartbeatPlaying) {
        was.pause();
        try { was.currentTime = 0; } catch {}
      }
    }, 520);
  }

  function setHeartbeatWanted(wanted) {
    if (audio.heartbeatWanted === wanted) return;
    audio.heartbeatWanted = wanted;
    if (wanted) startHeartbeat();
    else stopHeartbeat();
  }

  async function enableAudio() {
    if (!backgroundMusic) return;
    audio.userMuted = false;
    backgroundMusic.muted = false;
    try {
      backgroundMusic.volume = audio.heartbeatWanted ? 0.16 : 0.23;
      await backgroundMusic.play();
      audio.on = true;
      audio.autoplayBlocked = false;
      soundButton?.setAttribute('aria-pressed', 'true');
      soundButton?.setAttribute('aria-label', 'قطع موسیقی و صدا');
      if (audio.heartbeatWanted) startHeartbeat();
    } catch {
      audio.on = false;
      audio.autoplayBlocked = true;
      soundButton?.setAttribute('aria-pressed', 'false');
    }
  }

  function disableAudio() {
    audio.userMuted = true;
    audio.on = false;
    backgroundMusic?.pause();
    if (heartbeatAudio) {
      heartbeatAudio.pause();
      heartbeatAudio.volume = 0;
      try { heartbeatAudio.currentTime = 0; } catch {}
    }
    audio.heartbeatPlaying = false;
    soundButton?.setAttribute('aria-pressed', 'false');
    soundButton?.setAttribute('aria-label', 'فعال‌سازی موسیقی و صدا');
  }

  async function tryAutoplayMusic() {
    if (!backgroundMusic || audio.userMuted) return;
    try {
      backgroundMusic.muted = false;
      backgroundMusic.volume = 0.23;
      await backgroundMusic.play();
      audio.on = true;
      audio.autoplayBlocked = false;
      soundButton?.setAttribute('aria-pressed', 'true');
      soundButton?.setAttribute('aria-label', 'قطع موسیقی و صدا');
    } catch {
      audio.autoplayBlocked = true;
    }
  }

  soundButton?.addEventListener('click', () => (audio.on ? disableAudio() : enableAudio()));

  const unlockAudioOnGesture = (event) => {
    if (soundButton && (event.target === soundButton || soundButton.contains(event.target))) return;
    if (!audio.userMuted && !audio.on) enableAudio().catch(() => {});
  };
  window.addEventListener('pointerdown', unlockAudioOnGesture, { passive: true, capture: true });
  window.addEventListener('touchstart', unlockAudioOnGesture, { passive: true, capture: true });
  window.addEventListener('keydown', unlockAudioOnGesture, { passive: true, capture: true });

  function updateAudio() {
    // File-based cinematic music remains continuous. Chapter-specific audio is
    // handled by setHeartbeatWanted() to keep ECG entry/exit deterministic.
  }

  function onScroll() {
    scrollY = window.scrollY;
    const delta = scrollY - lastScrollY;
    scrollVelocity = lerp(scrollVelocity, delta, 0.32);
    lastScrollY = scrollY;
    targetHeroP = heroProgressFromScroll(scrollY);
    topbar?.classList.toggle('is-scrolled', scrollY > 24);
    updateInvitationManualReadiness(scrollY);

  }

  function onPointer(e) {
    pointer.x = (e.clientX / innerWidth) * 2 - 1;
    pointer.y = (e.clientY / innerHeight) * 2 - 1;
  }

  function animateCursor(e) {
    if (!cursor || coarse) return;
    cursor.style.transform = `translate3d(${e.clientX - 17}px,${e.clientY - 17}px,0)`;
  }

  function frameLoop() {
    stepAutoScroll(performance.now());
    smoothHeroP = reduceMotion ? targetHeroP : lerp(smoothHeroP, targetHeroP, mobile ? 0.27 : 0.18);
    pointer.sx = lerp(pointer.sx, pointer.x, 0.08);
    pointer.sy = lerp(pointer.sy, pointer.y, 0.08);
    scrollVelocity *= 0.88;
    updateCinematicLook();

    if (!reduceMotion) applyHeroFrame();
    updateHeroUI(smoothHeroP);
    updateChapters(scrollY);
    drawDepth();
    updateAudio();

    raf = requestAnimationFrame(frameLoop);
  }

  function initSpotlightSurfaces() {
    const surfaces = $$('.spotlight-surface');
    surfaces.forEach((surface) => {
      if ($('.surface-spotlight', surface)) return;
      const layer = document.createElement('div');
      layer.className = 'surface-spotlight';
      layer.setAttribute('aria-hidden', 'true');
      surface.appendChild(layer);
    });
    if (coarse || reduceMotion) return;
    document.addEventListener('pointermove', (event) => {
      const surface = event.target.closest?.('.spotlight-surface');
      if (!surface) return;
      const rect = surface.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = clamp((event.clientX - rect.left) / rect.width) * 100;
      const y = clamp((event.clientY - rect.top) / rect.height) * 100;
      surface.style.setProperty('--spotlight-x', `${x.toFixed(1)}%`);
      surface.style.setProperty('--spotlight-y', `${y.toFixed(1)}%`);
    }, { passive: true });
  }

  function initCursor() {
    if (coarse || !cursor) return;
    document.addEventListener('pointermove', (e) => {
      onPointer(e);
      animateCursor(e);
    }, { passive: true });
    $$('a,button').forEach((el) => {
      el.addEventListener('mouseenter', () => cursor.classList.add('hot'));
      el.addEventListener('mouseleave', () => cursor.classList.remove('hot'));
    });
  }

  function initLinks() {
    $$('a[href^="#"]').forEach((a) => {
      a.addEventListener('click', (e) => {
        const id = a.getAttribute('href');
        const target = id && $(id);
        if (!target) return;
        e.preventDefault();
        const y = target.getBoundingClientRect().top + window.scrollY;
        seekAutoScroll(y);
      });
    });
  }

  function initMailEntrance() {
    if (!mailIntro || !mailEnvelope || !mailCard || !mailSeal) {
      body.classList.remove('invitation-locked');
      body.classList.add('invitation-entered');
      startAutoScroll({ reset: true, force: true });
      return;
    }

    let opening = false;
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, reduceMotion ? Math.min(ms, 30) : ms));

    function waxChips() {
      const box = mailSeal.getBoundingClientRect();
      const count = lowPower ? 5 : 9;
      for (let i = 0; i < count; i += 1) {
        const chip = document.createElement('i');
        chip.className = 'mail-wax-chip';
        chip.style.left = `${box.left + box.width / 2 - 3}px`;
        chip.style.top = `${box.top + box.height / 2 - 3}px`;
        document.body.appendChild(chip);
        const angle = Math.random() * Math.PI * 2;
        const distance = 20 + Math.random() * 42;
        const rot = (Math.random() - 0.5) * 220;
        try {
          if (typeof chip.animate === 'function' && !reduceMotion) {
            chip.animate([
              { transform: 'translate(0,0) rotate(0) scale(1)', opacity: .92 },
              { transform: `translate(${Math.cos(angle) * distance}px,${Math.sin(angle) * distance + 20}px) rotate(${rot}deg) scale(.25)`, opacity: 0 }
            ], { duration: 560 + Math.random() * 150, easing: 'cubic-bezier(.14,.72,.2,1)' });
          } else {
            chip.style.opacity = '0';
          }
        } catch {
          chip.style.opacity = '0';
        }
        setTimeout(() => chip.remove(), reduceMotion ? 40 : 800);
      }
    }

    function sealTactileFx() {
      try {
        navigator.vibrate?.(18);
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx();
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(145, now);
        osc.frequency.exponentialRampToValueAtTime(58, now + .12);
        gain.gain.setValueAtTime(.0001, now);
        gain.gain.exponentialRampToValueAtTime(.028, now + .008);
        gain.gain.exponentialRampToValueAtTime(.0001, now + .16);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now); osc.stop(now + .18);
        setTimeout(() => { try { ctx.close(); } catch {} }, 400);
      } catch {}
    }

    async function runAnimation(el, keyframes, options = {}) {
      if (!el) return null;
      const lastFrame = keyframes[keyframes.length - 1] || {};
      const duration = reduceMotion ? 1 : Number(options.duration || 0);
      const delay = reduceMotion ? 0 : Number(options.delay || 0);
      const safeOptions = { ...options, duration, delay };
      if (reduceMotion || typeof el.animate !== 'function') {
        Object.entries(lastFrame).forEach(([key, value]) => {
          if (key !== 'offset' && key !== 'easing' && key !== 'composite') el.style[key] = value;
        });
        if (duration + delay > 1) await wait(duration + delay);
        return null;
      }
      try {
        const animation = el.animate(keyframes, safeOptions);
        await withTimeout(animation.finished.catch(() => false), duration + delay + 350);
        return animation;
      } catch {
        Object.entries(lastFrame).forEach(([key, value]) => {
          if (key !== 'offset' && key !== 'easing' && key !== 'composite') el.style[key] = value;
        });
        return null;
      }
    }

    let entranceFinished = false;
    async function finishEntrance() {
      if (entranceFinished) return;
      entranceFinished = true;
      try { mailIntro?.getAnimations?.({ subtree: true }).forEach((a) => a.cancel()); } catch {}
      // The video has been warming since initial page parse. Before handing the
      // page to auto-scroll, make sure at least one decodable frame is available.
      // This wait is bounded and runs behind the envelope animation, so it is
      // normally invisible to the visitor.
      await ensureHeroVideoReadyForStory(5000).catch(() => false);
      try { mailCard?.getAnimations?.().forEach((a) => a.cancel()); } catch {}
      try { mailCard?.remove(); } catch {}
      try { mailIntro?.remove(); } catch {}
      body.classList.remove('invitation-locked', 'invitation-opening');
      body.classList.add('invitation-entered');
      window.scrollTo(0, 0);
      syncAutoScrollTo(0);
      targetHeroP = 0; smoothHeroP = 0; targetFrame = 0; displayedFrame = 0; lastAppliedFrame = -1;
      if (heroReady) { try { heroVideo.pause(); heroVideo.currentTime = 0; } catch {} }
      startAutoScroll({ reset: true, force: true });
    }

    async function openMail(event) {
      event?.preventDefault?.();
      if (opening || entranceFinished) return;
      opening = true;
      mailSeal.disabled = true;
      body.classList.add('invitation-opening');
      window.scrollTo(0, 0);
      syncAutoScrollTo(0);

      // Audio is intentionally fire-and-forget. On slow connections, awaiting
      // HTMLMediaElement.play() can delay the envelope interaction indefinitely.
      void enableAudio().catch(() => {});
      sealTactileFx();

      try {
        mailSeal.classList.add('is-cracking');
        await wait(150);
        mailSeal.classList.add('is-released');
        waxChips();
        await wait(190);

        mailEnvelope.classList.add('is-open');
        await wait(520);

        const envH = Math.max(1, mailEnvelope.getBoundingClientRect().height);
        const compact = innerWidth <= 820;
        const y1 = -envH * (compact ? .47 : .50);
        const y2 = -envH * (compact ? .91 : .94);
        const anim1 = await runAnimation(mailCard, [
          { transform: 'translateY(0) scale(1)' },
          { transform: `translateY(${y1}px) scale(1.006)` }
        ], { duration: 620, easing: 'cubic-bezier(.17,.78,.18,1)', fill: 'forwards' });
        try { anim1?.cancel(); } catch {}
        mailCard.style.transform = `translateY(${y1}px) scale(1.006)`;

        const anim2 = await runAnimation(mailCard, [
          { transform: `translateY(${y1}px) scale(1.006)` },
          { transform: `translateY(${y2}px) scale(1.025)` }
        ], { duration: 500, easing: 'cubic-bezier(.16,.8,.16,1)', fill: 'forwards' });
        try { anim2?.cancel(); } catch {}
        mailCard.style.transform = `translateY(${y2}px) scale(1.025)`;
        mailCard.classList.add('is-free', 'is-shimmering');
        await wait(220);

        const rect = mailCard.getBoundingClientRect();
        document.body.appendChild(mailCard);
        Object.assign(mailCard.style, {
          position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
          right: 'auto', bottom: 'auto', transform: 'none', margin: '0', zIndex: '1300'
        });
        mailCard.classList.add('is-world');
        void mailCard.offsetWidth;
        mailCard.classList.add('is-fullscreen');
        mailIntro.classList.add('is-departing');

        const expandPromise = runAnimation(mailCard, [
          { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, borderRadius: '13px' },
          { left: '0px', top: '0px', width: `${innerWidth}px`, height: `${innerHeight}px`, borderRadius: '0px' }
        ], { duration: 850, easing: 'cubic-bezier(.16,.82,.14,1)', fill: 'forwards' });
        const fadePromise = runAnimation(mailIntro, [
          { opacity: 1 }, { opacity: .08 }
        ], { duration: 720, delay: 120, easing: 'ease-in', fill: 'forwards' });
        await Promise.allSettled([expandPromise, fadePromise]);

        await wait(320);
        body.classList.add('invitation-entered');
        await runAnimation(mailCard, [
          { opacity: 1, filter: 'blur(0)' },
          { opacity: 0, filter: 'blur(5px)' }
        ], { duration: 560, easing: 'cubic-bezier(.44,0,.72,.24)', fill: 'forwards' });
      } catch (error) {
        console.warn('[MAZUMS] Mail entrance recovered from an animation/media error:', error);
      } finally {
        await finishEntrance();
      }
    }

    mailSeal.addEventListener('click', openMail);
    mailSeal.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch' || e.pointerType === 'pen') openMail(e);
    }, { passive: false });
    mailSeal.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMail(e); }
    });

    if (!coarse && !reduceMotion) {
      mailIntro.addEventListener('pointermove', (e) => {
        if (opening) return;
        const r = mailStage.getBoundingClientRect();
        const nx = clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1) * 2 - 1;
        const ny = clamp((e.clientY - r.top) / Math.max(1, r.height), 0, 1) * 2 - 1;
        mailEnvelope.style.transform = `perspective(1800px) rotateX(${-ny * 3.6}deg) rotateY(${nx * 5.2}deg) rotateZ(${-0.35 + nx * .28}deg) translate3d(${nx * 5}px,${ny * 3}px,${Math.abs(nx) * 7 + Math.abs(ny) * 4}px)`;
      }, { passive: true });
      mailIntro.addEventListener('pointerleave', () => { if (!opening) mailEnvelope.style.transform = ''; }, { passive: true });
    }

    const params = new URLSearchParams(location.search);
    if (params.get('entrance') === 'skip') {
      mailIntro.remove();
      body.classList.remove('invitation-locked');
      body.classList.add('invitation-entered');
      startAutoScroll({ reset: true, force: true });
    }
  }

  async function init() {
    setLoader(0.035);
    setLoaderStatus('در حال برقراری ارتباط و بررسی فایل‌های موردنیاز…');

    // Strict boot contract: nothing behind the loader becomes interactive until
    // every required asset has fully downloaded, decoded, and passed runtime
    // health checks. Failures stay on the loader instead of revealing a partial UI.
    await downloadAllRequiredAssets();
    await verifyVisualAssetsAndFonts();
    await verifyMediaAssets();

    computeMetrics();
    initSpotlightSurfaces();
    initCursor();
    initAutoScroll();
    initLinks();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('resize', () => {
      const y = window.scrollY;
      computeMetrics();
      buildAutoScrollTimeline();
      syncAutoScrollTo(y);
      targetHeroP = heroProgressFromScroll(window.scrollY);
    }, { passive: true });
    window.addEventListener('pagehide', () => {
      if (preloadedVideoURL) { try { URL.revokeObjectURL(preloadedVideoURL); } catch {} preloadedVideoURL = null; }
      if (backgroundMusicBlobURL) { try { URL.revokeObjectURL(backgroundMusicBlobURL); } catch {} backgroundMusicBlobURL = null; }
      if (heartbeatBlobURL) { try { URL.revokeObjectURL(heartbeatBlobURL); } catch {} heartbeatBlobURL = null; }
    }, { once: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        heroVideo.pause();
        backgroundMusic?.pause();
        heartbeatAudio?.pause();
        if (audio.heartbeatPlaying) audio.heartbeatPlaying = false;
      } else {
        autoScroll.lastTime = performance.now();
        if (audio.on && !audio.userMuted) {
          backgroundMusic?.play().catch(() => {});
          if (audio.heartbeatWanted) startHeartbeat();
        }
      }
    });

    updateChapterNavigation(activeChapter);
    onScroll();
    if (reduceMotion) {
      heroVideo.poster = versioned('assets/hero-poster.webp');
      try { heroVideo.currentTime = 0; } catch {}
    }

    initMailEntrance();
    await verifyRuntimeEngine();

    requestAnimationFrame(() => {
      onScroll();
      frameLoop();
      requestAnimationFrame(() => closeLoader());
    });
  }

  init().catch((error) => {
    showLoaderFailure(error);
  });

})();
