/* Preferences, capability detection, and the named media queries every other
   module branches on. Single source of truth: nothing else parses a query
   string or reads a storage key directly.

   Storage keys are duplicated in the inline <head> script in index.html, which
   has to run before first paint. security-static.test.js asserts they match. */

export const KEYS = Object.freeze({
  enabled: "j3w1.wm.enabled",
  boot: "j3w1.wm.boot",
  lock: "j3w1.wm.lock",
  notify: "j3w1.wm.notify",
  layout: "j3w1.wm.layout",
  booted: "j3w1.wm.booted",
});

export const LOCK_THRESHOLDS = Object.freeze({ off: 0, "10m": 600000, "30m": 1800000 });

const readLocal = (key, fallback) => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};

const writeLocal = (key, value) => {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
};

export const removeLocal = (key) => {
  try {
    localStorage.removeItem(key);
  } catch {
    /* private mode: preferences simply do not persist */
  }
};

export const prefs = {
  get enabled() {
    return readLocal(KEYS.enabled, "1") !== "0";
  },
  set enabled(value) {
    writeLocal(KEYS.enabled, value ? "1" : "0");
  },
  get boot() {
    return readLocal(KEYS.boot, "1") !== "0";
  },
  set boot(value) {
    writeLocal(KEYS.boot, value ? "1" : "0");
  },
  get lock() {
    const value = readLocal(KEYS.lock, "10m");
    return value in LOCK_THRESHOLDS ? value : "10m";
  },
  set lock(value) {
    if (value in LOCK_THRESHOLDS) writeLocal(KEYS.lock, value);
  },
  get notify() {
    return readLocal(KEYS.notify, "1") !== "0";
  },
  set notify(value) {
    writeLocal(KEYS.notify, value ? "1" : "0");
  },
};

export const media = Object.freeze({
  mobile: matchMedia("(max-width: 767px)"),
  narrow: matchMedia("(max-width: 420px)"),
  coarse: matchMedia("(pointer: coarse)"),
  reducedMotion: matchMedia("(prefers-reduced-motion: reduce)"),
});

export const params = new URLSearchParams(location.search);

export const isPlainRequested = () => params.has("plain") || !prefs.enabled;

export const isSelfTest = () => params.get("wm") === "selftest";

/* The greeter decision is made in the inline <head> script so it can act before
   first paint; this only reads the flag it left behind. */
export const shouldGreet = () => document.documentElement.dataset.boot === "greeter";

export const clearGreetFlag = () => {
  delete document.documentElement.dataset.boot;
};

export const supported = () =>
  typeof requestAnimationFrame === "function" &&
  typeof Map === "function" &&
  typeof matchMedia === "function" &&
  "pointerType" in (window.PointerEvent?.prototype ?? {});
