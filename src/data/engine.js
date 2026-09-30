// Engine classes, race rules and scoring.

// AI difficulty fields (read by AIDriver / roster; see src/entities/AIDriver.js "Difficulty"):
//   aiSkill        base driving skill 0..1 (lines, braking, drift timing, reactions, noise)
//   aiPace         AI top-speed multiplier (kart.topSpeedScale) before rubber-banding; rivals add aiRivalPace
//   aiRubberBand   max upward rubber band when far behind the player (+x of top speed)
//   aiRestrain     max slow-down when ahead of the player (-x of top speed)
//   aiMaxMiniTurbo highest mini-turbo level the AI charges to (1 blue, 2 orange, 3 purple)
//   aiDriftRate    multiplier on how often the AI drifts corners (0..1)
//   aiLineSlop     0..1 blend of the racing line towards the road centre (wider, less optimal lines)
//   aiItemOffense  0..1 chance an attack item is used offensively (else kept as a shield / thrown late)
//   itemAggression item reaction speed / appetite multiplier
//   aiRivals       how many AI rivals (the main threats) are picked per race; aiRivalPace / aiRivalSkill = their bonus
export const ENGINE_CLASSES = {
  50: {
    cc: 50, label: '50cc', topSpeed: 26, accelScale: 0.85,
    aiSkill: 0.15, aiPace: 0.935, aiRubberBand: 0.03, aiRestrain: 0.06, aiMaxMiniTurbo: 1, aiDriftRate: 0.4, aiLineSlop: 0.25,
    aiItemOffense: 0.15, itemAggression: 0.3, aiRivals: 0, aiRivalPace: 0, aiRivalSkill: 0,
  },
  100: {
    cc: 100, label: '100cc', topSpeed: 31, accelScale: 0.95,
    aiSkill: 0.5, aiPace: 0.97, aiRubberBand: 0.05, aiRestrain: 0.05, aiMaxMiniTurbo: 2, aiDriftRate: 0.75, aiLineSlop: 0.15,
    aiItemOffense: 0.5, itemAggression: 0.6, aiRivals: 1, aiRivalPace: 0.015, aiRivalSkill: 0.06,
  },
  150: {
    cc: 150, label: '150cc', topSpeed: 36, accelScale: 1.0,
    aiSkill: 0.76, aiPace: 0.975, aiRubberBand: 0.05, aiRestrain: 0.04, aiMaxMiniTurbo: 3, aiDriftRate: 1, aiLineSlop: 0.05,
    aiItemOffense: 0.85, itemAggression: 0.85, aiRivals: 2, aiRivalPace: 0, aiRivalSkill: 0.08,
  },
  200: {
    cc: 200, label: '200cc', topSpeed: 44, accelScale: 1.12,
    aiSkill: 0.9, aiPace: 0.99, aiRubberBand: 0.05, aiRestrain: 0.03, aiMaxMiniTurbo: 3, aiDriftRate: 1, aiLineSlop: 0,
    aiItemOffense: 1, itemAggression: 1.05, aiRivals: 2, aiRivalPace: 0, aiRivalSkill: 0.05,
  },
};
export const CC_LIST = [50, 100, 150, 200];
export const DEFAULT_CC = 150;

export const RACERS_PER_RACE = 8;
export const DEFAULT_LAPS = 3;

/** Grand Prix points by finishing place (index 0 = 1st). */
export const GP_POINTS = [15, 12, 10, 8, 6, 4, 2, 1];

/** Max credits (coins) a racer can hold; each credit adds a little top speed. */
export const MAX_CREDITS = 10;
export const CREDIT_SPEED_BONUS = 0.01; // +1% top speed per credit

/** Race modes. */
export const MODES = {
  gp: { id: 'gp', label: 'Grand Prix', items: true, ai: true },
  vs: { id: 'vs', label: 'VS Race', items: true, ai: true },
  tt: { id: 'tt', label: 'Time Trial', items: false, ai: false },
};

/** Physics tick used by Race (fixed step). */
export const PHYSICS_DT = 1 / 120;
