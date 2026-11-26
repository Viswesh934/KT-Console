import assert from "node:assert/strict";
import { createFlagsmithClient } from "../public/flagsmith-client.js";

const events = [];
const sdk = {
  init(options) { this.options = options; },
  hasFeature(name) { return name === "sample_flag"; },
  getValue(name) { return name === "theme" ? "sage" : undefined; },
  identify(identifier, traits) { this.identity = { identifier, traits }; },
  logout() { this.loggedOut = true; },
};

const client = createFlagsmithClient(sdk);
assert.equal(client.hasFeature("sample_flag"), false, "features fail closed before init");
assert.equal(client.getValue("theme", "fallback"), "fallback");
assert.equal(client.init(""), false, "empty environment keys do not initialize the SDK");
assert.equal(client.init("test-environment-key"), true);
assert.equal(client.hasFeature("sample_flag"), true);
assert.equal(client.getValue("theme"), "sage");
assert.equal(client.getValue("missing", "fallback"), "fallback");
client.identify("member-1", { experience_level: "junior" });
assert.deepEqual(sdk.identity, { identifier: "member-1", traits: { experience_level: "junior" } });
client.subscribe((event) => events.push(event));
sdk.options.onChange({ old: true }, { source: "test" });
assert.deepEqual(events, [{ oldFlags: { old: true }, params: { source: "test" } }]);
client.logout();
assert.equal(sdk.loggedOut, true);
console.log("Flagsmith adapter smoke check passed.");
