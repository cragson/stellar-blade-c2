// Unit tests for the save reader/writer and the inventory model.
//   node --test tests/unit.test.js
// Uses a small synthetic save with the same structure as a real one. To also run against a real
// save:  SB_SAVE=/path/to/StellarBladeSave00.sav node --test tests/unit.test.js
//
// Copyright (C) 2026 cragson - SPDX-License-Identifier: AGPL-3.0-or-later
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const G = require("../docs/gvas.js");
const { Inventory, applyChanges, summary } = require("../docs/model.js");
const ITEMS = require("../docs/items.js");
const GAME = require("../docs/gamedata.js");
const { Progress } = require("../docs/progress.js");
const CHAPTERS = require("../docs/chapters.js");
const CH = require("../docs/chapter.js");

// ------------------------------------------------------------------ synthetic save
const zeros = (n) => new Uint8Array(n);
const P = (name, type, value, extra = {}) => ({ name, type, extra, value, aidx: 0, guid: null });
const S = (st, props) => ({ st, props, raw: null });
const guid = (n) => ({ st: "Guid", props: null, raw: Uint8Array.from({ length: 16 }, (_, i) => (n * 16 + i) & 0xff) });
const f32 = (x) => { const raw = new Uint8Array(4); new DataView(raw.buffer).setFloat32(0, x, true); return { f32: x, raw }; };
const bool = (name, on) => P(name, "BoolProperty", on ? 1 : 0, { bool: on ? 1 : 0 });
const SA = (name, istruct, array) => P(name, "ArrayProperty", { array, itag: { iname: name, itype: "StructProperty", istruct, iguid: zeros(16), ipguid: null } }, { inner: "StructProperty" });
const SP = (name, st, props) => P(name, "StructProperty", S(st, props), { struct: st, sguid: zeros(16) });
const vec = (name, x, y, z) => {
  const raw = new Uint8Array(12);
  const d = new DataView(raw.buffer);
  d.setFloat32(0, x, true); d.setFloat32(4, y, true); d.setFloat32(8, z, true);
  return P(name, "StructProperty", { st: "Vector", props: null, raw }, { struct: "Vector", sguid: zeros(16) });
};
const enumP = (name, en, v) => P(name, "ByteProperty", v, { enum: en });

// a real camp from the game data, stored as visited but not yet activated
const [CAMP, CAMP_INFO] = Object.entries(GAME.camps).find(([, c]) => Object.keys(c.objs).length >= 2);
const quest = (alias, state, taskState) => S("SBSaveGameData_Quest", [
  P("QuestAlias", "NameProperty", alias),
  P("QuestState", "IntProperty", state),
  SA("QuestTaskGroupList", "SBSaveGameData_QuestTaskGroup", taskState ? [S("SBSaveGameData_QuestTaskGroup", [
    P("TaskGroupAlias", "NameProperty", alias + "_M01"),
    enumP("TaskGroupState", "ESBQuestTaskGroupState", taskState),
    SA("TaskInfoList", "SBSaveGameData_QuestTaskInfo", [S("SBSaveGameData_QuestTaskInfo", [
      SA("TaskList", "SBSaveGameData_QuestTask", [S("SBSaveGameData_QuestTask", [
        P("TaskAlias", "NameProperty", alias + "_M01_T01"),
        enumP("TaskState", "ESBQuestTaskState", "ESBQuestTaskState_Progress"),
      ])]),
    ])]),
  ])] : []),
  P("LastUpdateTimestamp", "Int64Property", 639000000000000000n),
]);
const ach = (alias, value, done) => S("SBSaveGameData_AchievementInfo", [
  P("AchievementAlias", "NameProperty", alias), P("ProgressValue", "IntProperty", value), bool("bCompleted", done), bool("bRecievedReward", false),
]);

function item(n, alias, count, charge) {
  return S("SBSaveGameData_Item", [
    P("ItemAlias", "NameProperty", "None"),
    P("ItemCount", "IntProperty", 0),
    P("ItemInstance", "StructProperty", S("SBItemInstance", [
      P("SavedGuid", "StructProperty", guid(n), { struct: "Guid", sguid: zeros(16) }),
      P("PocketGuid", "StructProperty", guid(n + 100), { struct: "Guid", sguid: zeros(16) }),
      P("ItemAlias", "NameProperty", alias),
      P("ItemVisualAlias", "NameProperty", "None"),
      P("StatLevel", "UInt32Property", 1),
      P("ItemCount", "UInt32Property", count),
      P("ItemChargeCount", "UInt32Property", charge === undefined ? count : charge),
      bool("Equiped", false),
      P("MatVarIndex", "IntProperty", 0),
      P("OverrideSaveType", "ByteProperty", "ESBItemOverrideSaveType_Save", { enum: "ESBItemOverrideSaveType" }),
      bool("bWithResetZone", false),
      bool("bFavorites", n === 1),
      bool("bMustAcquisition", false),
    ]), { struct: "SBItemInstance", sguid: zeros(16) }),
  ]);
}

/** An item Eve is wearing: Equiped is set on its inventory entry, and the Equipment map holds a copy. */
function worn(n, alias) {
  const it = item(n, alias, 1);
  const eq = it.props[2].value.props.find((p) => p.name === "Equiped");
  eq.value = 1;
  eq.extra.bool = 1;
  return it;
}
const WORN = worn(6, "BS_Green_Suit");

function header() {
  const parts = [];
  const i32 = (x) => { const b = Buffer.alloc(4); b.writeInt32LE(x); parts.push(b); };
  const u16 = (x) => { const b = Buffer.alloc(2); b.writeUInt16LE(x); parts.push(b); };
  const str = (s) => { i32(s.length + 1); parts.push(Buffer.from(s + "\0", "ascii")); };
  parts.push(Buffer.from("GVAS"));
  i32(2); i32(525); u16(4); u16(26); u16(2); i32(0); str("++UE4+Release-4.26");
  i32(3); i32(0);
  str("/Script/SB.SBSaveGame");
  return new Uint8Array(Buffer.concat(parts));
}

function syntheticSave(extra = []) {
  const inventory = [
    ...extra,
    item(1, "BetaCrystal", 12345),
    item(2, "Money_JunkIron_C", 68),
    item(3, "betacore", 1),               // real saves contain lower-case aliases too
    item(4, "ConcussionGrenade", 22, 3),  // consumables: charge < count
    item(5, "SQ_011_Item_AccessCode_1", 1),
    WORN,
    item(7, "BS_Bayonetta_01", 1),
  ];
  const save = {
    evasVersion: 1,
    className: "/Script/SB.SBSaveGame",
    header: header(),
    trailer: zeros(4),
    props: [
      P("NewGameCreateTime", "Int64Property", 638700000000000000n),
      P("DataMap_SBActor", "MapProperty", { map: [["PlayerActor", S(null, [
        P("ActorDataAlias", "StrProperty", "Player"),
        P("HP", "FloatProperty", f32(4321)),
        P("SP", "IntProperty", 1),
        P("SPLevel", "IntProperty", 12),
        vec("ActorLocation", 1, 2, 3),
        P("LevelArray", "ArrayProperty", { array: [0, 4, 4, 5, 15, 3, 0] }, { inner: "IntProperty" }),
        vec("CampInteractActorLocation", 100, 200, 300),
        P("Equipment", "MapProperty", { map: [[5, S(null, structuredClone(WORN.props[2].value.props))]], removed: [] },
          { inner: "IntProperty", value: "StructProperty" }),
      ])]], removed: [] }, { inner: "NameProperty", value: "StructProperty" }),
      P("DataMap_SBAcquisitionSkill", "MapProperty", { map: [["AcquisitionSkill", S(null, [
        SA("AcquisitionSkillList", "SBSaveGameData_AcquisitionSkill", [S("SBSaveGameData_AcquisitionSkill", [P("AcquisitionSkillAlias", "NameProperty", "JustParry1")])]),
      ])]], removed: [] }, { inner: "NameProperty", value: "StructProperty" }),
      P("DataMap_SBEnv", "MapProperty", { map: [["Env", S(null, [
        SA("ZoneContainerList", "SBSaveGameData_ZoneContainer", [S("SBSaveGameData_ZoneContainer", [
          P("ZoneAlias", "NameProperty", Object.values(CAMP_INFO.objs)[0][1]),
          SA("ZoneEnvStorageList", "SBSaveGameData_EnvStorage", Object.keys(CAMP_INFO.objs).map((a) => S("SBSaveGameData_EnvStorage", [
            P("EnvStateSlotTag", "NameProperty", "Off"),
            enumP("EnvActivate", "ESBObjectState", "ESBObject_Disable"),
            enumP("EnvActiveState", "ESBENV_State", "ESBENV_State_Deactive"),
            P("EnvAlias", "NameProperty", a),
            SA("StateInfoList", "SBSaveGameData_ZoneEnvStateInfo", ["Off", "On"].map((t) => S("SBSaveGameData_ZoneEnvStateInfo", [
              P("StateTagName", "NameProperty", t), bool("bDropedReward", false), P("CurrentProgressValue", "IntProperty", 0),
            ]))),
            vec("ActorLocation", 1, 2, 3),
            vec("ActorRotation", 0, 90, 0),
          ]))),
        ])]),
      ])]], removed: [] }, { inner: "NameProperty", value: "StructProperty" }),
      P("DataMap_SBQuest", "MapProperty", { map: [["Quest", S(null, [
        SA("ProgressQuestList", "SBSaveGameData_Quest", [quest("Quest_Sub_012", 1, "TaskGroup_Progress")]),
        SA("CompleteQuestList", "SBSaveGameData_Quest", [quest("Quest_Request_006", 3, "TaskGroup_Complete")]),
        SA("FailedQuestList", "SBSaveGameData_Quest", []),
        P("TrackingQuestAliases", "ArrayProperty", { array: ["Quest_Sub_012"] }, { inner: "NameProperty" }),
      ])]], removed: [] }, { inner: "NameProperty", value: "StructProperty" }),
      SP("SBAchievement", "SBSaveGameData_Achievement", [
        SA("AchievementList", "SBSaveGameData_AchievementInfo", [ach("Trophy_Activate_AllCamp", 21, false), ach("Ach_Album_Unlock_Opener", 0, false)]),
      ]),
      SP("GamePlayProgressRecordData", "SBSaveGameData_PlayRecordData", [
        P("ProgressRecordGroup", "MapProperty", { map: [["Quest_Epic_01_M01", S(null, [
          P("RecordGroupName", "NameProperty", "Quest_Epic_01_M01"),
          P("RecordTaskGroupMap", "MapProperty", { map: [["ESBMission_Achievement", S(null, [
            SA("TaskDataList", "SBSaveGameData_PlayRecordTaskData", [S("SBSaveGameData_PlayRecordTaskData", [bool("bSuccessTask", true), P("DataAlias", "NameProperty", "Xion_Phase_1")])]),
          ])]], removed: [] }, { inner: "ByteProperty", value: "StructProperty" }),
        ])]], removed: [] }, { inner: "NameProperty", value: "StructProperty" }),
      ]),
      SP("UIStorage", "SBSaveGameData_UI", [
        SA("RedDotArray", "SBSaveGameData_RedDot", ["New", "Dirty", "New"].map((st, i) => S("SBSaveGameData_RedDot", [
          P("DotAlias", "NameProperty", "Dot" + i), enumP("DotState", "ESBUIRedDotState", "ESBUIRedDotState_" + st),
        ]))),
      ]),
      SP("SBShopHistory", "SBSaveGameData_ShopLimitedItemHistory", [
        P("Purchase", "MapProperty", { map: [["Xion_10_EnvS_007", S(null, [P("Count", "IntProperty", 3)])]], removed: [] },
          { inner: "NameProperty", value: "StructProperty" }),
        P("FriendShip", "MapProperty", { map: [["Shop_Kaya", S(null, [P("TotalFriendShip", "FloatProperty", f32(5000)), P("FriendShipLevel", "IntProperty", 2)])]], removed: [] },
          { inner: "NameProperty", value: "StructProperty" }),
      ]),
      SP("SBHint", "SBSaveGameData_Hint", [P("CompleteHintList", "ArrayProperty", { array: [GAME.hints[0]] }, { inner: "NameProperty" })]),
      P("DataMap_FString", "MapProperty", { map: [["MapName", "E04"], ["TurntableSoundAlias", "Turtable_Music_1"]], removed: [] },
        { inner: "NameProperty", value: "StrProperty" }),
      P("DataMap_int32", "MapProperty", { map: [["GameDifficulty", 1], ["NewGamePlusPlayCount", 1], ["PlayTime", 3725]], removed: [] },
        { inner: "NameProperty", value: "IntProperty" }),
      P("DataMap_int64", "MapProperty", { map: [["DateTime", 639000000000000000n], ["EndingTimeStamp_KillElder", 0n],
        ["EndingTimeStamp_KillLily", 639300000000000000n], ["EndingTimeStamp_SaveLily", 0n]], removed: [] },
        { inner: "NameProperty", value: "Int64Property" }),
      P("DataMap_SBItem", "MapProperty", { map: [["Item", S(null, [
        P("Inventory", "ArrayProperty", { array: inventory, itag: { iname: "Inventory", itype: "StructProperty", istruct: "SBSaveGameData_Item", iguid: zeros(16), ipguid: null } }, { inner: "StructProperty" }),
        P("ItemOtaineSet", "SetProperty", { set: ["BetaCrystal", "Money_JunkIron_C"], removed: [] }, { inner: "NameProperty" }),
        P("HealItemSlotIndex", "IntProperty", 0),
      ])]], removed: [] }, { inner: "NameProperty", value: "StructProperty" }),
      P("DataMap_float", "MapProperty", { map: [["Exposure", f32(1.25)]], removed: [] }, { inner: "NameProperty", value: "FloatProperty" }),
      P("PlayerName", "StrProperty", "Ève 이브"), // non-ASCII strings are written as UTF-16
    ],
  };
  return G.serialize(save);
}

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// ------------------------------------------------------------------ tests
test("synthetic save round-trips byte for byte", () => {
  const bytes = syntheticSave();
  const again = G.serialize(G.parse(bytes));
  assert.ok(same(bytes, again));
});

test("reads inventory, skill points and HP", () => {
  const inv = new Inventory(G.parse(syntheticSave()), ITEMS);
  assert.equal(inv.count("BetaCrystal"), 12345);
  assert.equal(inv.count("BetaCore"), 1, "aliases are case-insensitive");
  assert.equal(inv.totals().BetaCore, 1, "totals use the catalog spelling");
  assert.equal(inv.sp, 1);
  assert.equal(inv.hp, 4321);
});

test("sets Gold and clamps to the game's maximum", () => {
  const { bytes, report } = applyChanges(syntheticSave(), ITEMS, { items: { BetaCrystal: 999999999 } });
  assert.equal(report[0].after, ITEMS.BetaCrystal.max);
  assert.equal(new Inventory(G.parse(bytes), ITEMS).count("BetaCrystal"), 100000000);
});

test("adds a new item with fresh GUIDs and records it as obtained", () => {
  const { bytes } = applyChanges(syntheticSave(), ITEMS, { items: { BodyCore: 3 } });
  const inv = new Inventory(G.parse(bytes), ITEMS);
  assert.equal(inv.count("BodyCore"), 3);
  const e = inv.entries("BodyCore")[0];
  const ii = G.getProp(e, "ItemInstance").value;
  assert.notDeepEqual(G.getProp(ii, "SavedGuid").value.raw, guid(1).raw, "new SavedGuid");
  assert.equal(G.getProp(ii, "bFavorites").value, 0, "flags copied from the template are cleared");
  assert.ok(inv.obtained.value.set.includes("BodyCore"));
});

test("updates an item stored with a different capitalisation instead of duplicating it", () => {
  const { bytes } = applyChanges(syntheticSave(), ITEMS, { items: { BetaCore: 4 } });
  const inv = new Inventory(G.parse(bytes), ITEMS);
  assert.equal(inv.entries("BetaCore").length, 1);
  assert.equal(inv.count("BetaCore"), 4);
});

test("keeps the charged amount of consumables", () => {
  const { bytes } = applyChanges(syntheticSave(), ITEMS, { items: { ConcussionGrenade: 50 } });
  const inv = new Inventory(G.parse(bytes), ITEMS);
  const ii = G.getProp(inv.entries("ConcussionGrenade")[0], "ItemInstance").value;
  assert.equal(G.getProp(ii, "ItemCount").value, 50);
  assert.equal(G.getProp(ii, "ItemChargeCount").value, 3);
});

test("removing an item to 0 deletes its entry", () => {
  const { bytes } = applyChanges(syntheticSave(), ITEMS, { items: { Money_JunkIron_C: 0 } });
  assert.equal(new Inventory(G.parse(bytes), ITEMS).entries("Money_JunkIron_C").length, 0);
});

test("sets skill points", () => {
  const { bytes } = applyChanges(syntheticSave(), ITEMS, { sp: 99 });
  assert.equal(new Inventory(G.parse(bytes), ITEMS).sp, 99);
});

test("untouched data survives an edit unchanged", () => {
  const before = G.parse(syntheticSave());
  const after = G.parse(applyChanges(syntheticSave(), ITEMS, { items: { BetaCrystal: 5 } }).bytes);
  const pick = (s, n) => G.serialize({ ...s, props: s.props.filter((p) => p.name === n) });
  for (const n of ["NewGameCreateTime", "DataMap_SBActor", "DataMap_int32", "DataMap_int64", "DataMap_float", "PlayerName"]) {
    assert.ok(same(pick(before, n), pick(after, n)), n);
  }
});

test("rejects damaged files and files that aren't saves", () => {
  const bytes = syntheticSave();
  bytes[bytes.length - 20] ^= 0xff;
  assert.throws(() => G.parse(bytes), /checksum/);
  assert.throws(() => G.parse(new TextEncoder().encode("hello, this is not a save file at all, really not")), /isn't a Stellar Blade save/);
});

test("the catalog's quick-add items all exist", () => {
  for (const a of ["ElastomerFiber", "PolymerOrganicFilm", "ECelluloseRayon", "LowDensityWafer", "HighDensityWafer",
    "2DQuantumWafer", "Money_JunkIron_A", "Money_JunkIron_B", "Money_JunkIron_C", "BodyCore", "BetaCore", "GearCore",
    "DroneCore", "TumblerCore", "WeaponCore", "SPInitializer", "Item_Worm_Bait"]) {
    assert.ok(ITEMS[a] && ITEMS[a].catalog, a);
  }
});

test("edition, pre-order and collaboration items are tagged with the purchase they need", () => {
  assert.equal(ITEMS.BS_Nikke_01.gate, "NIKKE collaboration");
  assert.equal(ITEMS.BS_99.gate, "Complete Edition");
  assert.equal(ITEMS.BS_01_Var2.gate, "Deluxe Edition");
  assert.equal(ITEMS.Earring_005.gate, "Pre-order bonus");
  assert.equal(ITEMS.Hair_Nier_001.gate, "NieR:Automata collaboration");
  for (const cat of ["gear", "exospine", "blueprint", "collectible"]) {
    assert.ok(Object.values(ITEMS).filter((i) => i.cat === cat).every((i) => !i.gate), cat);
  }
  assert.equal(Object.values(ITEMS).filter((i) => i.cat === "outfit" && !i.gate).length, 116);
});

test("summarises the save for the overview", () => {
  const s = summary(G.parse(syntheticSave()), ITEMS);
  assert.equal(s.playTime, 3725);
  assert.equal(s.difficulty, "Story Mode"); // ESBGameDifficultyType: Normal 0, Story 1, Hard 2
  assert.equal(s.playthrough, 2);
  assert.equal(s.level, 12);
  assert.equal(s.hp, 4321);
  assert.deepEqual(s.endings, { seen: 1, total: 3 });
  assert.equal(new Date(s.savedAt).toISOString().slice(0, 10), "2025-11-29");
  assert.equal(s.questsDone, 1);
  assert.equal(s.enemies, null, "missing data is null, not an error");
});

test("reads progress: difficulty, upgrades, skills, camps, quests, trophies", () => {
  const P = new Progress(G.parse(syntheticSave()), GAME);
  assert.equal(P.difficulty, 1);
  assert.equal(P.level(1), 4);
  assert.ok(P.learned().has("JustParry1"));
  assert.equal(P.campState(CAMP), "inactive");
  assert.deepEqual(P.questStates(), { Quest_Sub_012: "active", Quest_Request_006: "done" });
  assert.deepEqual(P.tracked(), ["Quest_Sub_012"]);
  assert.equal(P.newMarkers(), 2);
  assert.equal(P.shopHistory().length, 1);
  assert.equal(P.endingsSeen(), 1);
  const camps = P.trophyProgress().find((t) => t.ach === "Trophy_Activate_AllCamp");
  assert.equal(camps.value, 21);
});

test("applies every progress change and the file reads back", () => {
  const { bytes } = applyChanges(syntheticSave(), ITEMS, { progress: {
    difficulty: 2, levels: { 1: 9, 4: 40 }, learn: ["Counter1"], forget: ["JustParry1"], camps: [CAMP],
    questsDone: ["Quest_Sub_012", "Quest_Request_017"], questsReset: ["Quest_Request_006"], track: "",
    achievements: { Ach_Album_Unlock_Opener: 1, Ach_Album_Unlock_Behemoth: 1 },
    clearMarkers: true, restock: true, unstuck: true, finished: true,
  } }, GAME);
  assert.ok(same(bytes, G.serialize(G.parse(bytes))), "edited file round-trips");
  const P = new Progress(G.parse(bytes), GAME);
  assert.equal(P.difficulty, 2);
  assert.equal(P.level(1), 9);
  assert.equal(P.level(4), 40);
  assert.ok(P.learned().has("Counter1") && !P.learned().has("JustParry1"));
  assert.equal(P.campState(CAMP), "active");
  assert.deepEqual(P.questStates(), { Quest_Sub_012: "done", Quest_Request_017: "done" });
  assert.deepEqual(P.tracked(), []);
  const a = P.achievements();
  assert.ok(a.get("Ach_Album_Unlock_Opener").done && a.get("Ach_Album_Unlock_Behemoth").done, "existing and new achievements completed");
  assert.equal(a.get("Trophy_Activate_AllCamp").value, 21, "trophy progress untouched");
  assert.equal(P.newMarkers(), 0);
  assert.equal(P.shopHistory().length, 0);
  assert.equal(P.endingsSeen(), 3);
  const loc = G.getProp(P.player, "ActorLocation").value.raw;
  assert.equal(new DataView(loc.buffer, loc.byteOffset).getFloat32(0, true), 100, "Eve moved to her camp");
});

test("activates a camp in an area the save hasn't visited, at its level position", () => {
  const zone = Object.values(CAMP_INFO.objs)[0][1];
  const P0 = new Progress(G.parse(syntheticSave()), GAME);
  const other = Object.keys(GAME.camps).find((c) => c !== CAMP && P0.campState(c) === "unvisited" && P0.canCreateCamp(c) &&
    Object.values(GAME.camps[c].objs).every((o) => o[1] === zone));
  assert.ok(other, "a placeable camp in the same zone");
  const { bytes } = applyChanges(syntheticSave(), ITEMS, { progress: { camps: [other] } }, GAME);
  const P = new Progress(G.parse(bytes), GAME);
  assert.equal(P.campState(other), "active");
  const [alias, [, , loc]] = Object.entries(GAME.camps[other].objs)[0];
  const raw = G.getProp(P.envIndex().get(alias), "ActorLocation").value.raw;
  assert.ok(Math.abs(new DataView(raw.buffer, raw.byteOffset).getFloat32(0, true) - loc[0]) < 0.01, "stored at its level position");
});

test("added items fire the game's pickup events: rewards, shop unlocks, collections", () => {
  const { bytes } = applyChanges(syntheticSave(), ITEMS, { items: { FishingSkillBook1: 1, Can_001: 1, Fish_GoldFish: 1 } }, GAME);
  const P = new Progress(G.parse(bytes), GAME);
  const a = P.achievements();
  assert.ok(P.learned().has("P_Eve_FishingUpgrade1"), "fishing book grants its skill");
  assert.ok(a.get("Acquire_Item_Can_001").done, "the can shows in the vending machine");
  assert.ok(a.get("Fishing_Item_Fish_GoldFish").done, "the fish shows in the Album");
  assert.equal(a.get("Trophy_Activate_AllCamp").value, 21, "trophies stay untouched");
  assert.ok(![...a.keys()].some((k) => k.startsWith("Trophy_") && k !== "Trophy_Activate_AllCamp"), "no trophy entries created");
});

test("upgrades fire level-up events (shop unlocks at max level)", () => {
  const { bytes } = applyChanges(syntheticSave(), ITEMS, { progress: { levels: { 4: 40 } } }, GAME);
  assert.ok(new Progress(G.parse(bytes), GAME).achievements().get("Ach_UnlockShopItem_LevelMax_Weapon").done);
});

test("marking a quest done gives its reward; an amount you typed still wins", () => {
  const reward = Object.fromEntries(GAME.questRewards.Quest_Request_017);
  const { bytes } = applyChanges(syntheticSave(), ITEMS, { progress: { questsDone: ["Quest_Request_017"] } }, GAME);
  const inv = new Inventory(G.parse(bytes), ITEMS);
  assert.equal(inv.count("BetaCrystal"), 12345 + reward.BetaCrystal);
  const typed = applyChanges(syntheticSave(), ITEMS, { items: { BetaCrystal: 5 }, progress: { questsDone: ["Quest_Request_017"] } }, GAME);
  assert.equal(new Inventory(G.parse(typed.bytes), ITEMS).count("BetaCrystal"), 5);
});

test("items added by other tools can be registered as picked up", () => {
  const withCan = applyChanges(syntheticSave(), ITEMS, { items: { Can_002: 1 } }).bytes; // no game data: no events
  assert.ok(new Progress(G.parse(withCan), GAME).missingPickups("Can_002").length > 0);
  const { bytes } = applyChanges(withCan, ITEMS, { progress: { registerItems: true } }, GAME);
  assert.equal(new Progress(G.parse(bytes), GAME).missingPickups("Can_002").length, 0);
});

test("chapter select moves the story forward and only forward", () => {
  const save = G.parse(syntheticSave());
  const before = CH.currentPoint(save, CHAPTERS);
  assert.equal(before.record, 0, "first record done");
  const target = "EP01_Second_TowerFall";
  const { bytes } = applyChanges(syntheticSave(), ITEMS, { chapter: { key: target } }, GAME, CHAPTERS);
  assert.ok(same(bytes, G.serialize(G.parse(bytes))), "edited file round-trips");
  const after = G.parse(bytes);
  assert.equal(CH.currentPoint(after, CHAPTERS).chapter, target);
  const P = new Progress(after, GAME);
  assert.equal(P.questStates().Quest_Epic_01, "active", "the main quest is in progress");
  assert.deepEqual(P.tracked(), ["Quest_Epic_01"]);
  assert.throws(() => applyChanges(bytes, ITEMS, { chapter: { key: "EP01_First_Prologue" } }, GAME, CHAPTERS), /only moves forward/);
});

test("item names from a save can't reach built-in properties", () => {
  const save = G.parse(syntheticSave([item(6, "constructor", 1), item(7, "__proto__", 2), item(8, "toString", 3)]));
  const t = new Inventory(save, ITEMS).totals();
  assert.equal(Object.getPrototypeOf(t), null);
  assert.equal(t.constructor, 1);
  assert.equal(t.toString, 3);
  assert.equal(({}).constructor, Object, "nothing polluted");
  assert.doesNotThrow(() => { summary(save, ITEMS); new Progress(save, GAME).checkSkillCounts(); });
});

test("wardrobe: Eve wears another owned item and the Equiped flags follow", () => {
  const { bytes } = applyChanges(syntheticSave(), ITEMS, { progress: { equip: { 5: "BS_Bayonetta_01" } } }, GAME);
  const save = G.parse(bytes);
  assert.equal(new Progress(save, GAME).equipped()[5], "BS_Bayonetta_01");
  const inv = new Inventory(save, ITEMS);
  const flag = (a) => G.getProp(inv.instance(inv.entries(a)[0]), "Equiped").value;
  assert.equal(flag("BS_Bayonetta_01"), 1);
  assert.equal(flag("BS_Green_Suit"), 0, "the old outfit is taken off");
  assert.ok(same(bytes, G.serialize(save)));
});

test("wardrobe: Eve can wear an item added in the same download", () => {
  const suit = Object.keys(ITEMS).find((a) => ITEMS[a].cat === "outfit" && ITEMS[a].catalog && !ITEMS[a].gate && !["BS_Green_Suit", "BS_Bayonetta_01"].includes(a));
  const { bytes } = applyChanges(syntheticSave(), ITEMS, { items: { [suit]: 1 }, progress: { equip: { 5: suit } } }, GAME);
  assert.equal(new Progress(G.parse(bytes), GAME).equipped()[5], suit);
});

test("shop levels: friendship reaches the threshold and the level-up events fire", () => {
  const kaya = GAME.shops.find((s) => s.key === "Shop_Kaya");
  const { bytes } = applyChanges(syntheticSave(), ITEMS, { progress: { shops: { Shop_Kaya: 3 } } }, GAME);
  const P = new Progress(G.parse(bytes), GAME);
  assert.equal(P.shopLevel("Shop_Kaya"), 3);
  const fs = P.friendshipMap().find(([k]) => k === "Shop_Kaya")[1];
  assert.ok(G.getProp(fs, "TotalFriendShip").value.f32 >= kaya.levels[0] + kaya.levels[1]);
  const rules = (GAME.ev.rules["LevelUp/FriendShip"] || []).filter(([, ps]) => ps.some(([k, v]) => k === "ShopTag" && v === kaya.tag) && ps.some(([k, v]) => k === "LevelValue" && Number(v) === 3));
  assert.ok(rules.length, "the game has level 3 achievements for Kaya");
  for (const [a] of rules) assert.ok(P.achievements().get(a) && P.achievements().get(a).done, a);
});

test("camp music: unlocks tracks the way the game does and picks the one that plays", () => {
  const bundle = GAME.music.find((t) => t.need && t.need[0] === "item" && t.need[1] === "TurntableMusicBundle");
  const summer = GAME.music.find((t) => t.need && t.need[0] === "event" && /Summer/.test(t.need[1]));
  const { bytes } = applyChanges(syntheticSave(), ITEMS, { progress: { unlockTracks: [bundle.key, summer.key], music: bundle.key } }, GAME);
  const save = G.parse(bytes);
  const P = new Progress(save, GAME);
  assert.equal(P.music(), bundle.key);
  assert.equal(new Inventory(save, ITEMS).count("TurntableMusicBundle"), 1);
  assert.ok(P.achievements().get(summer.need[1]).done);
  assert.deepEqual(P.tracked(), ["Quest_Sub_012"], "quest tracking is a different setting");
});

test("tutorial hints: every pop-up is marked as seen", () => {
  const { bytes } = applyChanges(syntheticSave(), ITEMS, { progress: { hints: true } }, GAME);
  const list = new Progress(G.parse(bytes), GAME).hintList();
  assert.equal(new Set(list).size, GAME.hints.length);
  assert.equal(list.length, GAME.hints.length, "no duplicates");
});

test("New Game+ switch changes only the counter, never the New Game+ trophy marker", () => {
  for (const on of [0, 1]) {
    const { bytes } = applyChanges(syntheticSave(), ITEMS, { progress: { newGamePlus: on } }, GAME);
    const P = new Progress(G.parse(bytes), GAME);
    assert.equal(P.newGamePlus, on);
    assert.ok(!P.achievements().has("IsNewGamePlus"));
  }
});

test("Exospine levels: a new Exospine can be raised to level 3, and its level-up achievement completes", () => {
  const { bytes } = applyChanges(syntheticSave(), ITEMS, { items: { PT_Combo: 1 }, progress: { itemLevels: { PT_Combo: 3 } } }, GAME);
  const save = G.parse(bytes);
  const P = new Progress(save, GAME);
  assert.equal(P.itemLevel("PT_Combo", ITEMS), 3);
  assert.ok(P.achievements().get("LevelUp_Item_PT_Combo").done);
  assert.ok(same(bytes, G.serialize(save)));
});

test("side quest steps: start a quest at its 2nd step, and replay a finished one", () => {
  const { bytes } = applyChanges(syntheticSave(), ITEMS, { progress: { questSteps: { Quest_Sub_001: 1, Quest_Request_006: 0 } } }, GAME);
  const P = new Progress(G.parse(bytes), GAME);
  assert.equal(P.questStates().Quest_Sub_001, "active");
  assert.equal(P.questStep("Quest_Sub_001"), 1);
  assert.equal(P.questStates().Quest_Request_006, "active");
  assert.equal(P.questStep("Quest_Request_006"), 0);
  assert.ok(same(bytes, G.serialize(G.parse(bytes))));
});

test("compare: a changed amount, a new item and a learned skill show up as such, nothing else", () => {
  const { diffSaves } = require("../docs/diff.js");
  const before = G.parse(syntheticSave());
  const after = G.parse(applyChanges(syntheticSave(), ITEMS, { items: { BetaCrystal: 5, BodyCore: 2 } }, null).bytes);
  const d = diffSaves(before, after);
  const gold = d.find((x) => /Inventory\[BetaCrystal\]\.ItemInstance\.ItemCount$/.test(x.path));
  assert.equal(gold && gold.kind, "changed");
  assert.equal(gold.before, 12345);
  assert.equal(gold.after, 5);
  assert.ok(d.some((x) => x.kind === "added" && /Inventory\[BodyCore\]\.ItemInstance\.ItemCount$/.test(x.path)), "new item added");
  assert.ok(d.some((x) => x.kind === "added" && /ItemOtaineSet\{BodyCore\}$/.test(x.path)), "recorded as obtained");
  assert.ok(d.every((x) => /DataMap_SBItem/.test(x.path)), `only the inventory changed: ${d.map((x) => x.path).filter((p) => !/DataMap_SBItem/.test(p)).join(", ")}`);
  assert.equal(diffSaves(before, G.parse(syntheticSave())).length, 0, "the same save has no differences");
});

const real = process.env.SB_SAVE;
test("real save round-trips byte for byte", { skip: !real && "set SB_SAVE to run" }, () => {
  const bytes = new Uint8Array(fs.readFileSync(real));
  assert.ok(same(bytes, G.serialize(G.parse(bytes))));
  const { bytes: edited } = applyChanges(bytes, ITEMS, { items: { BetaCrystal: 1234567 } });
  assert.equal(new Inventory(G.parse(edited), ITEMS).count("BetaCrystal"), 1234567);
  const s = summary(G.parse(bytes), ITEMS);
  assert.ok(s.playTime > 0 && s.level > 0 && s.difficulty && s.savedAt);
  const now = CH.currentPoint(G.parse(bytes), CHAPTERS);
  const next = CHAPTERS.chapters.find((c) => c.i > now.record);
  const { bytes: jumped } = applyChanges(bytes, ITEMS, { chapter: { key: next.k } }, GAME, CHAPTERS);
  assert.equal(CH.currentPoint(G.parse(jumped), CHAPTERS).chapter, next.k, "real save jumps to the next chapter");
});

test("every file link in index.html carries the file's current fingerprint", () => {
  // a stale stamp lets a browser combine a new page with an old cached file: run python3 tools/stamp.py
  const { execFileSync } = require("node:child_process");
  const path = require("node:path");
  const out = execFileSync("python3", [path.join(__dirname, "..", "tools", "stamp.py"), "--check"], { encoding: "utf8" });
  assert.match(out, /nothing changed/);
});
