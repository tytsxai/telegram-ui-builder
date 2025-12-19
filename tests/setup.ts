type StorageKey = string;

const createMemoryStorage = (): Storage => {
  const store = new Map<StorageKey, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: StorageKey) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: StorageKey) {
      store.delete(key);
    },
    setItem(key: StorageKey, value: string) {
      store.set(key, String(value));
    },
  };
};

const ensureStorage = (target: typeof globalThis, key: "localStorage" | "sessionStorage") => {
  const current = target[key] as Storage | undefined;
  if (current && typeof current.clear === "function") return;

  const storage = createMemoryStorage();
  Object.defineProperty(target, key, {
    value: storage,
    configurable: true,
    enumerable: true,
    writable: true,
  });
};

ensureStorage(globalThis, "localStorage");
ensureStorage(globalThis, "sessionStorage");

if (typeof window !== "undefined") {
  ensureStorage(window, "localStorage");
  ensureStorage(window, "sessionStorage");
}
