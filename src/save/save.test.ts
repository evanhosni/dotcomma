/** The save module against jsdom's localStorage, with the account store (net/playerData) stubbed. */

export {}; // a module, for --isolatedModules (no imports: the module under test is required after jest.mock)

let mockAccountData: Record<string, unknown> | null = null;
let mockNotifyAccount: () => void = () => {};
jest.mock("../net/playerData", () => ({
  getPlayerData: () => mockAccountData,
  updatePlayerData: jest.fn(() => true),
  subscribePlayerData: (l: () => void) => {
    mockNotifyAccount = l;
    return () => {};
  },
}));

const KEY = "dotcomma:save";

const loadFresh = (): typeof import("./save") => {
  let mod!: typeof import("./save");
  jest.isolateModules(() => {
    mod = require("./save");
  });
  return mod;
};

beforeEach(() => {
  window.localStorage.clear();
  mockAccountData = null;
});

describe("save", () => {
  it("loads the device save at boot and writes one JSON object back", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ devmode: { noclip: true } }));
    const save = loadFresh();
    expect(save.getSave()).toEqual({ devmode: { noclip: true } });

    save.saveToDevice({ devmode: { noclip: true, physicsDebug: true } });
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toEqual({ devmode: { noclip: true, physicsDebug: true } });
    expect(save.getSave().devmode).toEqual({ noclip: true, physicsDebug: true });
  });

  it("starts empty from a corrupt or non-object blob instead of throwing", () => {
    for (const bad of ["{not json", "[1,2]", "null", "42"]) {
      window.localStorage.setItem(KEY, bad);
      expect(loadFresh().getSave()).toEqual({});
    }
  });

  it("merges the account save in when it arrives, the device winning shared fields", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ devmode: { noclip: true } }));
    const save = loadFresh();
    expect(save.getSave()).toEqual({ devmode: { noclip: true } }); // the account has not arrived yet
    mockAccountData = { devmode: { noclip: false, tintSkirts: true }, coins: 3 };
    mockNotifyAccount();
    // Shallow: the device's devmode object replaces the account's whole; other account fields join.
    expect(save.getSave()).toEqual({ devmode: { noclip: true }, coins: 3 });
  });
});
