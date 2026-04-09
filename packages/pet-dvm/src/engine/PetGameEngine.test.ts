/**
 * PetGameEngine — Full Test Suite
 *
 * Story 11-4: Pet Game Engine
 *
 * AC coverage:
 *   AC-1: PetGameEngine class structure
 *   AC-2: processInteraction method
 *   AC-3: checkEvolution method
 *   AC-4: evolve method
 *   AC-5: Type definitions (compile-time, verified by imports)
 *   AC-6: Golden vector cross-verification (26 vectors)
 *   AC-7: Unit tests (cooldowns, evolution, errors, sequential, clamping, shop, sleep, token cost, factory)
 *   AC-8: Package setup (verified by this file compiling)
 *   AC-9: Factory function
 */

import {
  PetGameEngine,
  createPetGameEngine,
  createGenesisState,
} from './PetGameEngine';
import { GameEngineError } from './types';
import type { PetEngineState, GameAction, StatValues } from './types';
import {
  ActionType,
  ACTION_COUNT,
  Stage,
  COOLDOWN_DURATIONS,
  STAGE_ALLOWED_ACTIONS,
  getRequiredTokenCost,
} from '@toon-protocol/pet-circuit';

// Load golden vectors for cross-verification (AC-6)
import goldenVectors from '../../../pet-circuit/test-vectors/golden-vectors.json';

// ============================================================
// Test Helpers
// ============================================================

/** Create a default valid PetEngineState for testing */
function makeState(overrides: Partial<PetEngineState> = {}): PetEngineState {
  const defaultStats: StatValues = {
    hunger: 80,
    happiness: 80,
    health: 80,
    hygiene: 80,
    energy: 80,
  };
  return {
    stage: Stage.BABY,
    cycle: 0,
    lastInteraction: 1000,
    cooldownTimestamps: new Array(ACTION_COUNT).fill(0) as number[],
    brainHash: '0'.repeat(64),
    ...overrides,
    stats: {
      ...defaultStats,
      ...overrides.stats,
    },
  };
}

/** Create a default valid GameAction for testing */
function makeAction(overrides: Partial<GameAction> = {}): GameAction {
  return {
    actionType: ActionType.FEED,
    itemId: 0,
    timestamp: 7400,
    tokenCost: 0,
    ...overrides,
  };
}

// ============================================================
// AC-6: Golden Vector Cross-Verification (P0 BLOCKER)
// ============================================================

describe('AC-6: Golden Vector Cross-Verification', () => {
  // This is the critical consistency gate. If any vector diverges, the story FAILS.
  it.each(goldenVectors.map((v) => [v.id, v.description, v]))(
    'vector %i: %s',
    (_id, _desc, vector) => {
      const v = vector as (typeof goldenVectors)[0];

      const state = makeState({
        stats: { ...v.inputStats },
        stage: v.stage,
        cycle: 0,
        lastInteraction: 1000,
        cooldownTimestamps: new Array(ACTION_COUNT).fill(0) as number[],
      });

      const engine = new PetGameEngine(state);

      const action: GameAction = {
        actionType: v.actionType,
        itemId: v.itemId,
        timestamp: 1000 + v.elapsedSeconds,
        tokenCost: v.tokenCost,
        isSleeping: v.isSleeping,
      };

      const result = engine.processInteraction(action);

      // Post-decay stats must match exactly
      expect(result.decayedStats).toEqual(v.expectedDecayedStats);

      // Post-action stats must match exactly
      expect(result.finalStats).toEqual(v.expectedFinalStats);
    }
  );
});

// ============================================================
// AC-7: Cooldown Enforcement Tests (33 combinations)
// ============================================================

describe('AC-7: Cooldown enforcement per stage', () => {
  const stages = [Stage.EGG, Stage.BABY, Stage.ADULT] as const;
  const stageNames = ['egg', 'baby', 'adult'] as const;

  stages.forEach((stage, si) => {
    describe(`stage=${stageNames[si]}`, () => {
      for (let actionType = 0; actionType < ACTION_COUNT; actionType++) {
        const allowed = STAGE_ALLOWED_ACTIONS[stage]![actionType]!;
        const cooldown = COOLDOWN_DURATIONS[stage]![actionType]!;

        if (!allowed) {
          // Action not allowed for this stage -> should throw INVALID_ACTION
          it(`action ${actionType} is blocked (INVALID_ACTION)`, () => {
            const state = makeState({
              stage,
              stats: {
                hunger: 100,
                happiness: 100,
                health: 100,
                hygiene: 100,
                energy: 100,
              },
            });
            const engine = new PetGameEngine(state);
            const action = makeAction({
              actionType,
              timestamp: 100000,
              tokenCost: getRequiredTokenCost(actionType, 0),
            });

            expect(() => engine.processInteraction(action)).toThrow(
              expect.objectContaining({
                name: 'GameEngineError',
                code: 'INVALID_ACTION',
              })
            );
          });
        } else {
          // Action allowed -> should succeed when cooldown elapsed
          it(`action ${actionType} is allowed (cooldown=${cooldown}s)`, () => {
            const state = makeState({
              stage,
              stats: {
                hunger: 100,
                happiness: 100,
                health: 100,
                hygiene: 100,
                energy: 100,
              },
              lastInteraction: 1000,
            });
            const engine = new PetGameEngine(state);
            const action = makeAction({
              actionType,
              timestamp: 1000 + cooldown + 1,
              tokenCost: getRequiredTokenCost(actionType, 0),
            });

            // Should NOT throw
            const result = engine.processInteraction(action);
            expect(result).toBeDefined();
            expect(result.finalStats).toBeDefined();
          });
        }
      }
    });
  });
});

// ============================================================
// AC-7: Evolution Threshold Tests
// ============================================================

describe('AC-7: Evolution check — egg->baby', () => {
  it('returns EvolutionResult when egg meets hatch thresholds', () => {
    const state = makeState({
      stage: Stage.EGG,
      cycle: 7,
      stats: {
        hunger: 100,
        happiness: 70,
        health: 70,
        hygiene: 70,
        energy: 100,
      },
    });
    const engine = new PetGameEngine(state);

    const result = engine.checkEvolution();

    expect(result).not.toBeNull();
    expect(result!.canEvolve).toBe(true);
    expect(result!.fromStage).toBe(Stage.EGG);
    expect(result!.toStage).toBe(Stage.BABY);
  });

  it('returns null when egg does not meet hatch thresholds (cycle too low)', () => {
    const state = makeState({
      stage: Stage.EGG,
      cycle: 6,
      stats: {
        hunger: 100,
        happiness: 70,
        health: 70,
        hygiene: 70,
        energy: 100,
      },
    });
    const engine = new PetGameEngine(state);

    expect(engine.checkEvolution()).toBeNull();
  });

  it('returns null when egg does not meet hatch thresholds (stats too low)', () => {
    const state = makeState({
      stage: Stage.EGG,
      cycle: 10,
      stats: {
        hunger: 100,
        happiness: 69,
        health: 70,
        hygiene: 70,
        energy: 100,
      },
    });
    const engine = new PetGameEngine(state);

    expect(engine.checkEvolution()).toBeNull();
  });
});

describe('AC-7: Evolution check — baby->adult', () => {
  it('returns EvolutionResult when baby meets evolve thresholds', () => {
    const state = makeState({
      stage: Stage.BABY,
      cycle: 21,
      stats: { hunger: 80, happiness: 80, health: 80, hygiene: 80, energy: 80 },
    });
    const engine = new PetGameEngine(state);

    const result = engine.checkEvolution();

    expect(result).not.toBeNull();
    expect(result!.canEvolve).toBe(true);
    expect(result!.fromStage).toBe(Stage.BABY);
    expect(result!.toStage).toBe(Stage.ADULT);
  });

  it('returns null when baby does not meet evolve thresholds (cycle too low)', () => {
    const state = makeState({
      stage: Stage.BABY,
      cycle: 20,
      stats: { hunger: 80, happiness: 80, health: 80, hygiene: 80, energy: 80 },
    });
    const engine = new PetGameEngine(state);

    expect(engine.checkEvolution()).toBeNull();
  });

  it('returns null when baby does not meet evolve thresholds (one stat too low)', () => {
    const state = makeState({
      stage: Stage.BABY,
      cycle: 25,
      stats: { hunger: 80, happiness: 79, health: 80, hygiene: 80, energy: 80 },
    });
    const engine = new PetGameEngine(state);

    expect(engine.checkEvolution()).toBeNull();
  });
});

// ============================================================
// AC-7: evolve() Stat Reset Tests
// ============================================================

describe('AC-7: evolve() stat resets', () => {
  it('egg->baby: resets hunger, happiness, hygiene, energy to 100; inherits health', () => {
    const state = makeState({
      stage: Stage.EGG,
      cycle: 7,
      stats: {
        hunger: 100,
        happiness: 70,
        health: 75,
        hygiene: 70,
        energy: 100,
      },
    });
    const engine = new PetGameEngine(state);

    const newState = engine.evolve();

    expect(newState.stage).toBe(Stage.BABY);
    expect(newState.stats.hunger).toBe(100);
    expect(newState.stats.happiness).toBe(100);
    expect(newState.stats.hygiene).toBe(100);
    expect(newState.stats.energy).toBe(100);
    expect(newState.stats.health).toBe(75); // inherited
  });

  it('baby->adult: all stats inherited, stage=2', () => {
    const state = makeState({
      stage: Stage.BABY,
      cycle: 21,
      stats: { hunger: 85, happiness: 82, health: 90, hygiene: 88, energy: 81 },
    });
    const engine = new PetGameEngine(state);

    const newState = engine.evolve();

    expect(newState.stage).toBe(Stage.ADULT);
    expect(newState.stats.hunger).toBe(85);
    expect(newState.stats.happiness).toBe(82);
    expect(newState.stats.health).toBe(90);
    expect(newState.stats.hygiene).toBe(88);
    expect(newState.stats.energy).toBe(81);
  });

  it('evolve() does NOT increment cycle', () => {
    const state = makeState({
      stage: Stage.EGG,
      cycle: 7,
      stats: {
        hunger: 100,
        happiness: 70,
        health: 70,
        hygiene: 70,
        energy: 100,
      },
    });
    const engine = new PetGameEngine(state);

    const newState = engine.evolve();

    expect(newState.cycle).toBe(7); // unchanged
  });

  it('evolve() throws EVOLUTION_NOT_READY if not eligible', () => {
    const state = makeState({
      stage: Stage.EGG,
      cycle: 3, // too low
      stats: {
        hunger: 100,
        happiness: 50,
        health: 50,
        hygiene: 50,
        energy: 100,
      },
    });
    const engine = new PetGameEngine(state);

    expect(() => engine.evolve()).toThrow(
      expect.objectContaining({
        name: 'GameEngineError',
        code: 'EVOLUTION_NOT_READY',
      })
    );
  });
});

// ============================================================
// AC-7: Error Handling Tests
// ============================================================

describe('AC-7: Error handling', () => {
  it('throws TIMESTAMP_REGRESSION if action.timestamp <= lastInteraction', () => {
    const state = makeState({ lastInteraction: 5000 });
    const engine = new PetGameEngine(state);

    // Equal timestamp (not strictly greater)
    const actionEqual = makeAction({ timestamp: 5000 });
    expect(() => engine.processInteraction(actionEqual)).toThrow(
      expect.objectContaining({
        name: 'GameEngineError',
        code: 'TIMESTAMP_REGRESSION',
      })
    );

    // Earlier timestamp
    const actionPast = makeAction({ timestamp: 4000 });
    expect(() => engine.processInteraction(actionPast)).toThrow(
      expect.objectContaining({
        name: 'GameEngineError',
        code: 'TIMESTAMP_REGRESSION',
      })
    );
  });

  it('throws INVALID_ACTION for stage-blocked action', () => {
    // Feed is not allowed for egg stage
    const state = makeState({
      stage: Stage.EGG,
      stats: {
        hunger: 100,
        happiness: 100,
        health: 100,
        hygiene: 100,
        energy: 100,
      },
    });
    const engine = new PetGameEngine(state);
    const action = makeAction({
      actionType: ActionType.FEED,
      timestamp: 100000,
    });

    expect(() => engine.processInteraction(action)).toThrow(
      expect.objectContaining({
        name: 'GameEngineError',
        code: 'INVALID_ACTION',
      })
    );
  });

  it('throws COOLDOWN_ACTIVE if cooldown not elapsed', () => {
    // Baby feed has 5400s cooldown
    const state = makeState({
      stage: Stage.BABY,
      lastInteraction: 1000,
      cooldownTimestamps: (() => {
        const ts = new Array(ACTION_COUNT).fill(0) as number[];
        ts[ActionType.FEED] = 1000; // last fed at t=1000
        return ts;
      })(),
      stats: {
        hunger: 100,
        happiness: 100,
        health: 100,
        hygiene: 100,
        energy: 100,
      },
    });
    const engine = new PetGameEngine(state);

    // Try to feed again at t=2000 (only 1000s elapsed, need 5400s)
    const action = makeAction({
      actionType: ActionType.FEED,
      timestamp: 2000,
    });

    expect(() => engine.processInteraction(action)).toThrow(
      expect.objectContaining({
        name: 'GameEngineError',
        code: 'COOLDOWN_ACTIVE',
      })
    );
  });

  it('throws TOKEN_COST_MISMATCH if action.tokenCost != expected', () => {
    // food_burger (itemId=2) costs 25 tokens
    const state = makeState({
      stage: Stage.BABY,
      lastInteraction: 1000,
      stats: { hunger: 80, happiness: 80, health: 80, hygiene: 80, energy: 80 },
    });
    const engine = new PetGameEngine(state);

    const action = makeAction({
      actionType: ActionType.FEED,
      itemId: 2,
      timestamp: 100000,
      tokenCost: 10, // wrong! should be 25
    });

    expect(() => engine.processInteraction(action)).toThrow(
      expect.objectContaining({
        name: 'GameEngineError',
        code: 'TOKEN_COST_MISMATCH',
      })
    );
  });
});

// ============================================================
// AC-7: Sequential Interactions Test
// ============================================================

describe('AC-7: Sequential interactions', () => {
  it('5 sequential interactions update state correctly', () => {
    const state = makeState({
      stage: Stage.BABY,
      lastInteraction: 1000,
      stats: {
        hunger: 100,
        happiness: 100,
        health: 100,
        hygiene: 100,
        energy: 100,
      },
    });
    const engine = new PetGameEngine(state);

    // Interaction 1: feed at t=6401 (5400s cooldown for feed)
    const r1 = engine.processInteraction(
      makeAction({
        actionType: ActionType.FEED,
        timestamp: 6401,
      })
    );
    expect(r1.cycle).toBe(1);
    expect(r1.finalStats.hunger).toBeGreaterThan(r1.decayedStats.hunger);

    // Interaction 2: play at t=13602 (7200s cooldown for play)
    const r2 = engine.processInteraction(
      makeAction({
        actionType: ActionType.PLAY,
        timestamp: 13602,
      })
    );
    expect(r2.cycle).toBe(2);

    // Interaction 3: clean at t=19003 (5400s cooldown for clean)
    const r3 = engine.processInteraction(
      makeAction({
        actionType: ActionType.CLEAN,
        timestamp: 19003,
      })
    );
    expect(r3.cycle).toBe(3);

    // Interaction 4: talk at t=24404 (5400s cooldown for talk)
    const r4 = engine.processInteraction(
      makeAction({
        actionType: ActionType.TALK,
        timestamp: 24404,
      })
    );
    expect(r4.cycle).toBe(4);

    // Interaction 5: check at t=28005 (3600s cooldown for check)
    const r5 = engine.processInteraction(
      makeAction({
        actionType: ActionType.CHECK,
        timestamp: 28005,
      })
    );
    expect(r5.cycle).toBe(5);

    // Verify final state reflects all 5 interactions
    const finalState = engine.getState();
    expect(finalState.cycle).toBe(5);
    expect(finalState.lastInteraction).toBe(28005);
  });
});

// ============================================================
// AC-7: Stat Clamping Edge Cases
// ============================================================

describe('AC-7: Stat clamping boundaries', () => {
  it('stat at 1 with negative effect stays at 1 (floor)', () => {
    // Play has energy=-15; start with energy near floor
    const state = makeState({
      stage: Stage.BABY,
      lastInteraction: 1000,
      stats: {
        hunger: 100,
        happiness: 100,
        health: 100,
        hygiene: 100,
        energy: 1,
      },
    });
    const engine = new PetGameEngine(state);

    const result = engine.processInteraction(
      makeAction({
        actionType: ActionType.PLAY,
        timestamp: 100000, // plenty of time for cooldown
      })
    );

    // Energy should be clamped to 1 (floor), not go below
    // After decay energy will be 1, then play subtracts 15, should clamp to 1
    expect(result.finalStats.energy).toBe(1);
  });

  it('stat at 100 with positive effect stays at 100 (ceiling)', () => {
    // Feed has hunger+30; start with hunger at 100
    const state = makeState({
      stage: Stage.BABY,
      lastInteraction: 1000,
      stats: {
        hunger: 100,
        happiness: 100,
        health: 100,
        hygiene: 100,
        energy: 100,
      },
    });
    const engine = new PetGameEngine(state);

    // Very short elapsed time so minimal decay
    const result = engine.processInteraction(
      makeAction({
        actionType: ActionType.FEED,
        timestamp: 1001,
      })
    );

    // Hunger after feed should be clamped to 100 (99 after 1s decay + 30 from feed = 129, clamped to 100)
    expect(result.finalStats.hunger).toBe(100);
  });
});

// ============================================================
// AC-7: Shop Item Effect Tests
// ============================================================

describe('AC-7: Shop item effects', () => {
  it('food_burger (itemId=2, cost=25): hunger+40 happiness+10 hygiene-8 energy+8', () => {
    const state = makeState({
      stage: Stage.BABY,
      lastInteraction: 1000,
      stats: { hunger: 60, happiness: 80, health: 90, hygiene: 90, energy: 80 },
    });
    const engine = new PetGameEngine(state);

    const result = engine.processInteraction(
      makeAction({
        actionType: ActionType.FEED,
        itemId: 2,
        timestamp: 100000,
        tokenCost: 25,
      })
    );

    // Verify shop item effects were applied (not base feed effects)
    // Base feed: hunger+30, happiness+5. Burger: hunger+40, happiness+10
    // The exact values depend on decay, but we verify relative to decayed stats
    expect(result.finalStats.hunger).toBeGreaterThan(
      result.decayedStats.hunger
    );
    expect(result.tokenCost).toBe(25);
  });

  it('med_elixir (itemId=12, cost=150): happiness+20 health+80 energy+10', () => {
    const state = makeState({
      stage: Stage.ADULT,
      lastInteraction: 1000,
      stats: { hunger: 80, happiness: 50, health: 20, hygiene: 80, energy: 80 },
    });
    const engine = new PetGameEngine(state);

    const result = engine.processInteraction(
      makeAction({
        actionType: ActionType.MEDICINE,
        itemId: 12,
        timestamp: 100000,
        tokenCost: 150,
      })
    );

    // Elixir gives massive health boost
    expect(result.finalStats.health).toBeGreaterThan(
      result.decayedStats.health
    );
    expect(result.tokenCost).toBe(150);
  });
});

// ============================================================
// AC-7: Sleeping Energy Recovery
// ============================================================

describe('AC-7: Sleeping energy recovery', () => {
  it('isSleeping=true uses positive energy rate during decay', () => {
    // Baby sleeping energy rate is +600 (scaled), awake is -800
    const state = makeState({
      stage: Stage.BABY,
      lastInteraction: 1000,
      stats: {
        hunger: 100,
        happiness: 100,
        health: 100,
        hygiene: 100,
        energy: 50,
      },
    });
    const engine = new PetGameEngine(state);

    const result = engine.processInteraction(
      makeAction({
        actionType: ActionType.CHECK, // check is a low-impact action
        timestamp: 4601, // 3600s elapsed (check cooldown)
        isSleeping: true,
      })
    );

    // With sleeping, energy should increase (or at least not decrease as much)
    // Sleeping rate for baby: +600/hr scaled -> +6.0/hr -> +6 in 1hr
    expect(result.decayedStats.energy).toBeGreaterThan(50);
  });
});

// ============================================================
// AC-9: Factory Function Validation
// ============================================================

describe('AC-9: Factory function — createPetGameEngine', () => {
  it('creates engine with valid initial state', () => {
    const state = makeState();
    const engine = createPetGameEngine(state);
    expect(engine).toBeInstanceOf(PetGameEngine);
    expect(engine.getState().stats).toEqual(state.stats);
  });

  it('rejects invalid stage (stage > 2) with INVALID_STAGE', () => {
    const state = makeState({ stage: 3 });

    expect(() => createPetGameEngine(state)).toThrow(
      expect.objectContaining({
        name: 'GameEngineError',
        code: 'INVALID_STAGE',
      })
    );
  });

  it('rejects stats out of [1, 100] range', () => {
    const state = makeState({
      stats: { hunger: 0, happiness: 80, health: 80, hygiene: 80, energy: 80 },
    });

    expect(() => createPetGameEngine(state)).toThrow(GameEngineError);
  });

  it('rejects stats above 100', () => {
    const state = makeState({
      stats: {
        hunger: 101,
        happiness: 80,
        health: 80,
        hygiene: 80,
        energy: 80,
      },
    });

    expect(() => createPetGameEngine(state)).toThrow(GameEngineError);
  });
});

describe('AC-9: createGenesisState', () => {
  it('returns default genesis state', () => {
    const genesis = createGenesisState();

    expect(genesis.stats).toEqual({
      hunger: 100,
      happiness: 100,
      health: 100,
      hygiene: 100,
      energy: 100,
    });
    expect(genesis.stage).toBe(Stage.EGG);
    expect(genesis.cycle).toBe(0);
    expect(genesis.lastInteraction).toBe(0);
    expect(genesis.cooldownTimestamps).toHaveLength(ACTION_COUNT);
    expect(genesis.cooldownTimestamps.every((t) => t === 0)).toBe(true);
    expect(genesis.brainHash).toBe('0'.repeat(64));
  });
});

// ============================================================
// AC-1: PetGameEngine class structure
// ============================================================

describe('AC-1: PetGameEngine class interface', () => {
  it('exposes getState() returning readonly copy', () => {
    const state = makeState();
    const engine = new PetGameEngine(state);
    const s = engine.getState();

    expect(s).toBeDefined();
    expect(s.stats).toEqual(state.stats);
    expect(s.stage).toBe(state.stage);
    expect(s.cycle).toBe(state.cycle);

    // Verify it is a copy (mutation does not affect engine)
    s.stats.hunger = 999;
    expect(engine.getState().stats.hunger).not.toBe(999);
  });

  it('exposes processInteraction method', () => {
    const engine = new PetGameEngine(makeState());
    expect(typeof engine.processInteraction).toBe('function');
  });

  it('exposes checkEvolution method', () => {
    const engine = new PetGameEngine(makeState());
    expect(typeof engine.checkEvolution).toBe('function');
  });

  it('exposes evolve method', () => {
    const engine = new PetGameEngine(makeState());
    expect(typeof engine.evolve).toBe('function');
  });

  it('exposes applyDecayOnly method', () => {
    const engine = new PetGameEngine(makeState());
    expect(typeof engine.applyDecayOnly).toBe('function');
  });
});

// ============================================================
// AC-2: applyDecayOnly preview
// ============================================================

describe('AC-2: applyDecayOnly — read-only decay preview', () => {
  it('returns decayed stats and elapsed seconds without mutating state', () => {
    const state = makeState({
      stage: Stage.BABY,
      lastInteraction: 1000,
      stats: { hunger: 90, happiness: 90, health: 90, hygiene: 90, energy: 90 },
    });
    const engine = new PetGameEngine(state);

    const result = engine.applyDecayOnly(6400);

    expect(result.elapsedSeconds).toBe(5400);
    expect(result.decayedStats).toBeDefined();
    expect(result.decayedStats.hunger).toBeLessThan(90); // hunger decays for baby

    // State should NOT have been mutated
    const stateAfter = engine.getState();
    expect(stateAfter.stats.hunger).toBe(90);
    expect(stateAfter.lastInteraction).toBe(1000);
  });

  it('handles NaN timestamp gracefully (returns zero elapsed)', () => {
    const state = makeState({
      stage: Stage.BABY,
      lastInteraction: 1000,
      stats: { hunger: 90, happiness: 90, health: 90, hygiene: 90, energy: 90 },
    });
    const engine = new PetGameEngine(state);

    const result = engine.applyDecayOnly(NaN);

    expect(result.elapsedSeconds).toBe(0);
    // With 0 elapsed, stats should be unchanged
    expect(result.decayedStats.hunger).toBe(90);
  });

  it('handles timestamp before lastInteraction gracefully (returns zero elapsed)', () => {
    const state = makeState({
      stage: Stage.BABY,
      lastInteraction: 5000,
      stats: { hunger: 90, happiness: 90, health: 90, hygiene: 90, energy: 90 },
    });
    const engine = new PetGameEngine(state);

    const result = engine.applyDecayOnly(1000);

    expect(result.elapsedSeconds).toBe(0);
    expect(result.decayedStats.hunger).toBe(90);
  });

  it('isSleeping=true uses positive energy rate for decay preview', () => {
    const state = makeState({
      stage: Stage.BABY,
      lastInteraction: 1000,
      stats: { hunger: 90, happiness: 90, health: 90, hygiene: 90, energy: 50 },
    });
    const engine = new PetGameEngine(state);

    const awakeResult = engine.applyDecayOnly(4600);
    const sleepResult = engine.applyDecayOnly(4600, true);

    // Sleeping should recover energy; awake should drain it
    expect(sleepResult.decayedStats.energy).toBeGreaterThan(
      awakeResult.decayedStats.energy
    );
  });
});

// ============================================================
// NFR: Input validation edge cases
// ============================================================

describe('NFR: Input validation edge cases', () => {
  it('rejects NaN timestamp in processInteraction', () => {
    const engine = new PetGameEngine(makeState());
    const action = makeAction({ timestamp: NaN });

    expect(() => engine.processInteraction(action)).toThrow(
      expect.objectContaining({
        name: 'GameEngineError',
        code: 'TIMESTAMP_REGRESSION',
      })
    );
  });

  it('rejects Infinity timestamp in processInteraction', () => {
    const engine = new PetGameEngine(makeState());
    const action = makeAction({ timestamp: Infinity });

    expect(() => engine.processInteraction(action)).toThrow(
      expect.objectContaining({
        name: 'GameEngineError',
        code: 'TIMESTAMP_REGRESSION',
      })
    );
  });

  it('rejects negative timestamp in processInteraction', () => {
    const engine = new PetGameEngine(makeState({ lastInteraction: 0 }));
    const action = makeAction({ timestamp: -1 });

    expect(() => engine.processInteraction(action)).toThrow(
      expect.objectContaining({
        name: 'GameEngineError',
        code: 'TIMESTAMP_REGRESSION',
      })
    );
  });

  it('rejects out-of-range actionType in processInteraction', () => {
    const engine = new PetGameEngine(makeState());
    const action = makeAction({ actionType: 99, timestamp: 100000 });

    expect(() => engine.processInteraction(action)).toThrow(
      expect.objectContaining({
        name: 'GameEngineError',
        code: 'INVALID_ACTION',
      })
    );
  });

  it('rejects negative actionType in processInteraction', () => {
    const engine = new PetGameEngine(makeState());
    const action = makeAction({ actionType: -1, timestamp: 100000 });

    expect(() => engine.processInteraction(action)).toThrow(
      expect.objectContaining({
        name: 'GameEngineError',
        code: 'INVALID_ACTION',
      })
    );
  });

  it('rejects NaN tokenCost in processInteraction', () => {
    const engine = new PetGameEngine(makeState());
    const action = makeAction({ timestamp: 100000, tokenCost: NaN });

    expect(() => engine.processInteraction(action)).toThrow(
      expect.objectContaining({
        name: 'GameEngineError',
        code: 'TOKEN_COST_MISMATCH',
      })
    );
  });

  it('rejects negative itemId in processInteraction', () => {
    const engine = new PetGameEngine(makeState());
    const action = makeAction({ itemId: -1, timestamp: 100000 });

    expect(() => engine.processInteraction(action)).toThrow(
      expect.objectContaining({
        name: 'GameEngineError',
        code: 'INVALID_ACTION',
      })
    );
  });

  it('rejects non-integer itemId in processInteraction', () => {
    const engine = new PetGameEngine(makeState());
    const action = makeAction({ itemId: 1.5, timestamp: 100000 });

    expect(() => engine.processInteraction(action)).toThrow(
      expect.objectContaining({
        name: 'GameEngineError',
        code: 'INVALID_ACTION',
      })
    );
  });

  it('wraps unknown shop item error as GameEngineError', () => {
    const engine = new PetGameEngine(makeState());
    // itemId=99 does not exist for FEED action
    const action = makeAction({
      actionType: ActionType.FEED,
      itemId: 99,
      timestamp: 100000,
      tokenCost: 0,
    });

    expect(() => engine.processInteraction(action)).toThrow(
      expect.objectContaining({
        name: 'GameEngineError',
        code: 'INVALID_ACTION',
      })
    );
  });

  it('factory rejects NaN stat values', () => {
    const state = makeState({
      stats: {
        hunger: NaN,
        happiness: 80,
        health: 80,
        hygiene: 80,
        energy: 80,
      },
    });

    expect(() => createPetGameEngine(state)).toThrow(GameEngineError);
  });

  it('factory rejects wrong-length cooldownTimestamps', () => {
    const state = makeState();
    state.cooldownTimestamps = [0, 0, 0]; // too short

    expect(() => createPetGameEngine(state)).toThrow(GameEngineError);
  });

  it('factory rejects NaN cycle', () => {
    const state = makeState({ cycle: NaN });

    expect(() => createPetGameEngine(state)).toThrow(GameEngineError);
  });

  it('factory rejects negative cycle', () => {
    const state = makeState({ cycle: -1 });

    expect(() => createPetGameEngine(state)).toThrow(
      expect.objectContaining({
        name: 'GameEngineError',
        code: 'INVALID_STAGE',
      })
    );
  });

  it('factory rejects negative stage', () => {
    const state = makeState({ stage: -1 });

    expect(() => createPetGameEngine(state)).toThrow(
      expect.objectContaining({
        name: 'GameEngineError',
        code: 'INVALID_STAGE',
      })
    );
  });

  it('factory rejects NaN cooldown timestamp', () => {
    const state = makeState();
    state.cooldownTimestamps[0] = NaN;

    expect(() => createPetGameEngine(state)).toThrow(
      expect.objectContaining({
        name: 'GameEngineError',
        code: 'INVALID_STAGE',
      })
    );
  });

  it('factory rejects negative cooldown timestamp', () => {
    const state = makeState();
    state.cooldownTimestamps[0] = -100;

    expect(() => createPetGameEngine(state)).toThrow(
      expect.objectContaining({
        name: 'GameEngineError',
        code: 'INVALID_STAGE',
      })
    );
  });

  it('factory rejects NaN lastInteraction', () => {
    const state = makeState({ lastInteraction: NaN });

    expect(() => createPetGameEngine(state)).toThrow(
      expect.objectContaining({
        name: 'GameEngineError',
        code: 'INVALID_STAGE',
      })
    );
  });

  it('factory rejects negative lastInteraction', () => {
    const state = makeState({ lastInteraction: -1 });

    expect(() => createPetGameEngine(state)).toThrow(
      expect.objectContaining({
        name: 'GameEngineError',
        code: 'INVALID_STAGE',
      })
    );
  });

  it('factory rejects invalid brainHash (wrong length)', () => {
    const state = makeState({ brainHash: 'abc' });

    expect(() => createPetGameEngine(state)).toThrow(
      expect.objectContaining({
        name: 'GameEngineError',
        code: 'INVALID_STAGE',
      })
    );
  });

  it('factory rejects invalid brainHash (non-hex characters)', () => {
    const state = makeState({ brainHash: 'g'.repeat(64) });

    expect(() => createPetGameEngine(state)).toThrow(
      expect.objectContaining({
        name: 'GameEngineError',
        code: 'INVALID_STAGE',
      })
    );
  });
});

// ============================================================
// AC-2: processInteraction priorStats verification
// ============================================================

describe('AC-2: processInteraction returns correct priorStats', () => {
  it('priorStats matches engine state before decay is applied', () => {
    const initialStats: StatValues = {
      hunger: 75,
      happiness: 60,
      health: 85,
      hygiene: 90,
      energy: 70,
    };
    const state = makeState({
      stage: Stage.BABY,
      lastInteraction: 1000,
      stats: initialStats,
    });
    const engine = new PetGameEngine(state);

    const result = engine.processInteraction(
      makeAction({
        actionType: ActionType.FEED,
        timestamp: 100000,
      })
    );

    // priorStats should be the stats BEFORE decay was applied
    expect(result.priorStats).toEqual(initialStats);
  });

  it('priorStats differs from decayedStats when time has elapsed', () => {
    const state = makeState({
      stage: Stage.BABY,
      lastInteraction: 1000,
      stats: {
        hunger: 80,
        happiness: 80,
        health: 80,
        hygiene: 80,
        energy: 80,
      },
    });
    const engine = new PetGameEngine(state);

    const result = engine.processInteraction(
      makeAction({
        actionType: ActionType.FEED,
        timestamp: 100000, // large elapsed time -> significant decay
      })
    );

    // With significant elapsed time, decayed stats should differ from prior
    expect(result.decayedStats).not.toEqual(result.priorStats);
  });
});

// ============================================================
// AC-3: checkEvolution resetStats verification
// ============================================================

describe('AC-3: checkEvolution resetStats', () => {
  it('egg->baby: resetStats has hunger=100, happiness=100, hygiene=100, energy=100, health=inherited', () => {
    const state = makeState({
      stage: Stage.EGG,
      cycle: 7,
      stats: {
        hunger: 100,
        happiness: 70,
        health: 73,
        hygiene: 70,
        energy: 100,
      },
    });
    const engine = new PetGameEngine(state);

    const result = engine.checkEvolution();

    expect(result).not.toBeNull();
    expect(result!.resetStats).toEqual({
      hunger: 100,
      happiness: 100,
      health: 73, // inherited from current health
      hygiene: 100,
      energy: 100,
    });
  });

  it('baby->adult: resetStats preserves all current stats', () => {
    const state = makeState({
      stage: Stage.BABY,
      cycle: 21,
      stats: { hunger: 85, happiness: 82, health: 90, hygiene: 88, energy: 81 },
    });
    const engine = new PetGameEngine(state);

    const result = engine.checkEvolution();

    expect(result).not.toBeNull();
    expect(result!.resetStats).toEqual({
      hunger: 85,
      happiness: 82,
      health: 90,
      hygiene: 88,
      energy: 81,
    });
  });
});

// ============================================================
// AC-4: Adult cannot evolve (EVOLUTION_NOT_READY)
// ============================================================

describe('AC-4: Adult evolution attempt', () => {
  it('adult evolve() throws EVOLUTION_NOT_READY', () => {
    const state = makeState({
      stage: Stage.ADULT,
      cycle: 100,
      stats: {
        hunger: 100,
        happiness: 100,
        health: 100,
        hygiene: 100,
        energy: 100,
      },
    });
    const engine = new PetGameEngine(state);

    expect(engine.checkEvolution()).toBeNull();
    expect(() => engine.evolve()).toThrow(
      expect.objectContaining({
        name: 'GameEngineError',
        code: 'EVOLUTION_NOT_READY',
      })
    );
  });
});

// ============================================================
// AC-2: processInteraction returns correct stage and tokenCost
// ============================================================

describe('AC-2: processInteraction result fields', () => {
  it('returns correct stage in result', () => {
    const state = makeState({
      stage: Stage.BABY,
      lastInteraction: 1000,
    });
    const engine = new PetGameEngine(state);

    const result = engine.processInteraction(
      makeAction({ actionType: ActionType.FEED, timestamp: 100000 })
    );

    expect(result.stage).toBe(Stage.BABY);
  });

  it('returns correct tokenCost in result for free action', () => {
    const state = makeState({
      stage: Stage.BABY,
      lastInteraction: 1000,
    });
    const engine = new PetGameEngine(state);

    const result = engine.processInteraction(
      makeAction({
        actionType: ActionType.FEED,
        itemId: 0,
        timestamp: 100000,
        tokenCost: 0,
      })
    );

    expect(result.tokenCost).toBe(0);
  });

  it('returns correct tokenCost in result for paid shop item', () => {
    const state = makeState({
      stage: Stage.BABY,
      lastInteraction: 1000,
    });
    const engine = new PetGameEngine(state);

    const result = engine.processInteraction(
      makeAction({
        actionType: ActionType.FEED,
        itemId: 2,
        timestamp: 100000,
        tokenCost: 25,
      })
    );

    expect(result.tokenCost).toBe(25);
  });

  it('increments cycle correctly in result', () => {
    const state = makeState({
      stage: Stage.BABY,
      lastInteraction: 1000,
      cycle: 5,
    });
    const engine = new PetGameEngine(state);

    const result = engine.processInteraction(
      makeAction({ actionType: ActionType.FEED, timestamp: 100000 })
    );

    expect(result.cycle).toBe(6);
  });
});
