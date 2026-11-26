/**
 * Reusable adapter for the official Flagsmith JavaScript SDK.
 * All evaluation stays in Flagsmith's SDK; this module only gives KT Console
 * one stable place for initialization, identity, and typed access to flags.
 */
export function createFlagsmithClient(sdk) {
  const resolveSdk = () => sdk || globalThis.window?.flagsmith;
  let initialized = false;
  const listeners = new Set();

  return {
    init(environmentId) {
      if (!environmentId) return false;
      if (initialized) return true;
      const client = resolveSdk();
      if (!client) throw new Error("Flagsmith SDK did not load.");
      sdk = client;
      sdk.init({
        environmentID: environmentId,
        onChange: (oldFlags, params) => listeners.forEach((listener) => listener({ oldFlags, params })),
      });
      initialized = true;
      return true;
    },
    hasFeature(name) {
      return initialized ? sdk.hasFeature(name) : false;
    },
    getValue(name, fallback = null) {
      if (!initialized) return fallback;
      const value = sdk.getValue(name);
      return value === undefined || value === null ? fallback : value;
    },
    identify(identifier, traits) {
      if (!initialized) throw new Error("Initialize Flagsmith before identifying a user.");
      return sdk.identify(identifier, traits);
    },
    logout() {
      if (initialized) return sdk.logout();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const flagsmithClient = createFlagsmithClient();
