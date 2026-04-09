/**
 * PetLifecycle ZkProgram -- Game Rule Constants
 *
 * All values from the canonical game rules doc (pet-zkapp-game-rules-canonical.md).
 * These are hardcoded into the circuit as lookup tables.
 *
 * @module constants
 */

// ============================================================
// Action Type Enum
// ============================================================
export const ActionType = {
  FEED: 0,
  PLAY: 1,
  CLEAN: 2,
  REST: 3,
  WARM: 4,
  CHECK: 5,
  SING: 6,
  TALK: 7,
  MEDICINE: 8,
  CRUZAR: 9,
  PLAY_MUSIC: 10,
} as const;

export const ACTION_COUNT = 11;

// ============================================================
// Stage Enum
// ============================================================
export const Stage = {
  EGG: 0,
  BABY: 1,
  ADULT: 2,
} as const;

export const STAGE_COUNT = 3;

// ============================================================
// Slot-bounded batch timestamp constants (Decision D10)
// ============================================================
export const MAX_CLOCK_SKEW = 300; // seconds
export const MAX_BATCH_WINDOW = 3600; // seconds

// ============================================================
// Decay Rates (scaled by 100, per hour)
// Section 2 of canonical doc
//
// Index: [stage][stat] where stat order is hunger, happiness, hygiene, energy, health_base
// Negative values represent decay, positive represent recovery.
// Energy has awake/sleeping variants -- circuit receives energy direction as input.
//
// Special cases:
//   - Egg: hunger fixed at 100, energy fixed at 100 (no decay)
//   - Health: computed separately with penalty system (see HEALTH_PENALTIES)
// ============================================================

/**
 * Base decay rates scaled by 100. Per hour.
 * [stage][stat]: hunger, happiness, hygiene, energy_awake, energy_sleeping, health_base
 */
export const DECAY_RATES: readonly (readonly number[])[] = [
  // Egg: hunger=0 (fixed 100), happiness varies (see egg happiness logic), hygiene=-800, energy=0 (fixed 100), health_base=-100
  //       hunger  happiness  hygiene  energy_awake  energy_sleep  health_base
  [0, 0, -800, 0, 0, -100],
  // Baby: hunger=-700, happiness=-400, hygiene=-500, energy_awake=-800, energy_sleep=+600, health_base=-75
  [-700, -400, -500, -800, 600, -75],
  // Adult: hunger=-450, happiness=-250, hygiene=-350, energy_awake=-500, energy_sleep=+500, health_base=-40
  [-450, -250, -350, -500, 500, -40],
] as const;

/**
 * Egg happiness decay rates (conditional, Section 2.1).
 * Applied instead of the base happiness rate for eggs.
 */
export const EGG_HAPPINESS_RATES = {
  GOOD: 200, // health >= 70 AND hygiene >= 70: +2.0/hr
  MODERATE: -200, // health >= 40 AND hygiene >= 40 (but not both >= 70): -2.0/hr
  POOR: -400, // health < 40 OR hygiene < 40: -4.0/hr
} as const;

/**
 * Egg health penalty rates (Section 2.1).
 * Additive with base health rate.
 */
export const EGG_HEALTH_PENALTIES = {
  HYGIENE_BELOW_70: -200, // hygiene < 70: -2.0/hr additional
  HYGIENE_BELOW_40: -300, // hygiene < 40: -3.0/hr additional (cumulative with above)
} as const;

/**
 * Baby health penalty rates (Section 2.2). All scaled by 100.
 * Cumulative -- multiple penalties can stack.
 */
export const BABY_HEALTH_PENALTIES = {
  HUNGER_BELOW_70: -75,
  HUNGER_BELOW_40: -125,
  HYGIENE_BELOW_70: -75,
  HYGIENE_BELOW_40: -125,
  ENERGY_BELOW_50: -50,
  ENERGY_BELOW_25: -100,
  HAPPINESS_BELOW_50: -50,
  HAPPINESS_BELOW_25: -100,
  REGEN_ALL_ABOVE_80: 150, // hunger >= 80 AND happiness >= 80 AND hygiene >= 80 AND energy >= 80
} as const;

/**
 * Adult health penalty rates (Section 2.3). All scaled by 100.
 * Cumulative.
 */
export const ADULT_HEALTH_PENALTIES = {
  HUNGER_BELOW_60: -50,
  HUNGER_BELOW_30: -100,
  HYGIENE_BELOW_60: -50,
  HYGIENE_BELOW_30: -100,
  ENERGY_BELOW_40: -40,
  ENERGY_BELOW_20: -80,
  HAPPINESS_BELOW_40: -40,
  HAPPINESS_BELOW_20: -80,
  REGEN_ALL_ABOVE_80: 100, // hunger >= 80 AND happiness >= 80 AND hygiene >= 80 AND energy >= 80
} as const;

// ============================================================
// Cooldown Durations (seconds) -- Section 4.2
// [stage][actionType] -- 0 means unavailable (infinite cooldown)
//
// Action order: feed, play, clean, rest, warm, check, sing, talk, medicine, cruzar, play_music
// play_music assigned 5400s for all stages (missing from canonical doc, see Dev Notes)
// ============================================================
export const COOLDOWN_DURATIONS: readonly (readonly number[])[] = [
  // Egg:    feed=inf  play=inf  clean=5400  rest=inf  warm=5400  check=3600  sing=5400  talk=5400  medicine=7200  cruzar=inf  play_music=5400
  [0, 0, 5400, 0, 5400, 3600, 5400, 5400, 7200, 0, 5400],
  // Baby:   feed=5400  play=7200  clean=5400  rest=14400  warm=inf  check=3600  sing=inf  talk=5400  medicine=7200  cruzar=inf  play_music=5400
  [5400, 7200, 5400, 14400, 0, 3600, 0, 5400, 7200, 0, 5400],
  // Adult:  feed=5400  play=7200  clean=5400  rest=14400  warm=inf  check=3600  sing=inf  talk=5400  medicine=10800  cruzar=86400  play_music=5400
  [5400, 7200, 5400, 14400, 0, 3600, 0, 5400, 10800, 86400, 5400],
] as const;

// ============================================================
// Stage-Allowed Actions -- derived from Section 3.1 + Section 4.2
// true = action is available for this stage
// ============================================================
export const STAGE_ALLOWED_ACTIONS: readonly (readonly boolean[])[] = [
  // Egg:   feed=N play=N clean=Y rest=N warm=Y check=Y sing=Y talk=Y medicine=Y cruzar=N play_music=Y
  [false, false, true, false, true, true, true, true, true, false, true],
  // Baby:  feed=Y play=Y clean=Y rest=Y warm=N check=Y sing=N talk=Y medicine=Y cruzar=N play_music=Y
  [true, true, true, true, false, true, false, true, true, false, true],
  // Adult: feed=Y play=Y clean=Y rest=Y warm=N check=Y sing=N talk=Y medicine=Y cruzar=Y play_music=Y
  [true, true, true, true, false, true, false, true, true, true, true],
] as const;

// ============================================================
// Base Action Effects -- Section 3.1
// [actionType][stat] where stat order: hunger, happiness, health, hygiene, energy
// ============================================================
export const BASE_ACTION_EFFECTS: readonly (readonly number[])[] = [
  // feed:       hunger=+30  happiness=+5   health=0   hygiene=0   energy=0
  [30, 5, 0, 0, 0],
  // play:       hunger=0    happiness=+25  health=0   hygiene=-5  energy=-15
  [0, 25, 0, -5, -15],
  // clean:      hunger=0    happiness=+10  health=0   hygiene=+40 energy=0
  [0, 10, 0, 40, 0],
  // rest:       hunger=0    happiness=+5   health=0   hygiene=0   energy=+50
  [0, 5, 0, 0, 50],
  // warm:       hunger=0    happiness=+2   health=+5  hygiene=0   energy=0
  [0, 2, 5, 0, 0],
  // check:      hunger=0    happiness=0    health=+2  hygiene=0   energy=0
  [0, 0, 2, 0, 0],
  // sing:       hunger=0    happiness=+15  health=0   hygiene=0   energy=-5
  [0, 15, 0, 0, -5],
  // talk:       hunger=0    happiness=+10  health=0   hygiene=0   energy=0
  [0, 10, 0, 0, 0],
  // medicine:   hunger=0    happiness=-5   health=+30 hygiene=0   energy=0
  [0, -5, 30, 0, 0],
  // cruzar:     hunger=0    happiness=+20  health=0   hygiene=0   energy=-10
  [0, 20, 0, 0, -10],
  // play_music: hunger=0    happiness=+15  health=0   hygiene=0   energy=0
  [0, 15, 0, 0, 0],
] as const;

// ============================================================
// Shop Item Effects -- Section 3.2
// Each item: [actionType, itemId, tokenCost, hunger, happiness, health, hygiene, energy]
//
// itemId is 1-based sequential index:
//   Food: 1=apple, 2=burger, 3=cake, 4=pizza, 5=sushi
//   Toy: 6=ball, 7=teddy, 8=blocks
//   Medicine: 9=vitamins, 10=super, 11=bandage, 12=elixir, 13=shell_repair, 14=calcium
//   Hygiene: 15=soap, 16=shampoo, 17=bubble, 18=towel
// ============================================================
export interface ShopItem {
  readonly actionType: number;
  readonly itemId: number;
  readonly tokenCost: number;
  readonly effects: readonly number[]; // [hunger, happiness, health, hygiene, energy]
}

export const SHOP_ITEMS: readonly ShopItem[] = [
  // Food items (action: feed)
  {
    actionType: ActionType.FEED,
    itemId: 1,
    tokenCost: 10,
    effects: [15, 0, 0, -2, 5],
  }, // food_apple
  {
    actionType: ActionType.FEED,
    itemId: 2,
    tokenCost: 25,
    effects: [40, 10, 0, -8, 8],
  }, // food_burger
  {
    actionType: ActionType.FEED,
    itemId: 3,
    tokenCost: 50,
    effects: [20, 30, 0, -10, 10],
  }, // food_cake
  {
    actionType: ActionType.FEED,
    itemId: 4,
    tokenCost: 35,
    effects: [35, 15, 0, -9, 10],
  }, // food_pizza
  {
    actionType: ActionType.FEED,
    itemId: 5,
    tokenCost: 45,
    effects: [30, 0, 10, -6, 7],
  }, // food_sushi

  // Toy items (action: play)
  {
    actionType: ActionType.PLAY,
    itemId: 6,
    tokenCost: 30,
    effects: [0, 25, 0, -5, -10],
  }, // toy_ball
  {
    actionType: ActionType.PLAY,
    itemId: 7,
    tokenCost: 60,
    effects: [0, 40, 0, 0, -15],
  }, // toy_teddy
  {
    actionType: ActionType.PLAY,
    itemId: 8,
    tokenCost: 40,
    effects: [0, 30, 0, 0, -10],
  }, // toy_blocks

  // Medicine items (action: medicine)
  {
    actionType: ActionType.MEDICINE,
    itemId: 9,
    tokenCost: 40,
    effects: [0, 0, 20, 0, 0],
  }, // med_vitamins
  {
    actionType: ActionType.MEDICINE,
    itemId: 10,
    tokenCost: 100,
    effects: [0, -10, 50, 0, 20],
  }, // med_super
  {
    actionType: ActionType.MEDICINE,
    itemId: 11,
    tokenCost: 20,
    effects: [0, 0, 15, 0, 0],
  }, // med_bandage
  {
    actionType: ActionType.MEDICINE,
    itemId: 12,
    tokenCost: 150,
    effects: [0, 20, 80, 0, 10],
  }, // med_elixir
  {
    actionType: ActionType.MEDICINE,
    itemId: 13,
    tokenCost: 60,
    effects: [0, 0, 30, 0, 0],
  }, // med_shell_repair (egg only)
  {
    actionType: ActionType.MEDICINE,
    itemId: 14,
    tokenCost: 35,
    effects: [0, 0, 35, 0, 0],
  }, // med_calcium

  // Hygiene items (action: clean)
  {
    actionType: ActionType.CLEAN,
    itemId: 15,
    tokenCost: 15,
    effects: [0, 0, 0, 30, 0],
  }, // hyg_soap
  {
    actionType: ActionType.CLEAN,
    itemId: 16,
    tokenCost: 25,
    effects: [0, 10, 0, 50, 0],
  }, // hyg_shampoo
  {
    actionType: ActionType.CLEAN,
    itemId: 17,
    tokenCost: 40,
    effects: [0, 20, 0, 60, 0],
  }, // hyg_bubble
  {
    actionType: ActionType.CLEAN,
    itemId: 18,
    tokenCost: 20,
    effects: [0, 5, 0, 25, 0],
  }, // hyg_towel
] as const;

/** Max shop item ID (for bounds checking in circuit) */
export const MAX_ITEM_ID = 18;

// ============================================================
// Evolution Thresholds -- Section 5
// ============================================================
export const EVOLUTION_THRESHOLDS = {
  HATCH: {
    minCycle: 7,
    minHealth: 70,
    minHygiene: 70,
    minHappiness: 70,
    requiredStage: Stage.EGG,
    targetStage: Stage.BABY,
  },
  EVOLVE: {
    minCycle: 21,
    minHunger: 80,
    minHappiness: 80,
    minHealth: 80,
    minHygiene: 80,
    minEnergy: 80,
    requiredStage: Stage.BABY,
    targetStage: Stage.ADULT,
  },
} as const;

// ============================================================
// Token Cost Lookup
// For base actions (itemId=0), cost is 0 (placeholder per Section 9).
// For shop items, cost is from SHOP_ITEMS table.
// ============================================================

/**
 * Look up the required token cost for an action + item combination.
 * Returns 0 for base actions (itemId=0), or the shop item's tokenCost.
 * Throws if a non-zero itemId does not match any known shop item for the given actionType.
 */
export function getRequiredTokenCost(
  actionType: number,
  itemId: number
): number {
  if (itemId === 0) return 0; // base action, no cost
  const item = SHOP_ITEMS.find(
    (si) => si.actionType === actionType && si.itemId === itemId
  );
  if (!item) {
    throw new Error(
      `Unknown shop item: actionType=${actionType}, itemId=${itemId}`
    );
  }
  return item.tokenCost;
}
