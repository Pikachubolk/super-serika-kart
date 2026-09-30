// Race roster helpers (owner: race agent): who races, grid order, AI skill + personalities.
//
//   buildRoster({ mode, playerCharacterId, rivalIds }) -> Character[]      player first
//   buildGridOrder(roster, gridOrder?) -> characterId[]                     slot 0 = pole
//   aiProfile(characterId, engine, rng, { isPlayer }) -> { skill, personality }
//   PERSONALITIES                                                            per-character driving style
//
// Personalities (passed straight to AIDriver; unknown fields are ignored by it):
//   lineOffset  metres the racer biases its line (+ = right)       aggression  multiplier (~1) item / bump appetite
//   driftiness  multiplier (~1) how eagerly it drifts               skill       additive skill offset (halved)
//   (the 0..1 numbers in PERSONALITIES are mapped onto those multipliers by aiProfile)
//   extras: startReaction (s), mistakes (0..1), itemPatience (0..1), recklessness (0..1)
//   rivalTier (0..1): how likely the character is picked as one of the race's AI "rivals" (ENGINE_CLASSES.aiRivals,
//   the strongest few AI, like Mario Kart). aiProfile turns it into personality.rivalScore (random per race, biased
//   by the tier); AIDriver ranks the scores of the karts in the race. personality.autopilot marks the player's
//   own kart (always competent, never slowed by the difficulty class).

import { CHARACTERS, getCharacter } from '../data/characters.js';
import { RACERS_PER_RACE } from '../data/engine.js';
import { clamp } from '../core/utils.js';

export const PERSONALITIES = {
  // determined all-rounder, a little hot-headed with items
  serika: { rivalTier: 0.6, skill: 0.0, lineOffset: 0.4, aggression: 0.65, driftiness: 0.75, startReaction: 0.05, mistakes: 0.25, itemPatience: 0.4 },
  // athletic and precise, cold-blooded item use
  shiroko: { rivalTier: 0.85, skill: 0.04, lineOffset: -0.6, aggression: 0.7, driftiness: 0.85, startReaction: 0.02, mistakes: 0.1, itemPatience: 0.7 },
  // lazy starter who wakes up later in the race
  hoshino: { rivalTier: 0.5, skill: -0.03, lineOffset: 0.9, aggression: 0.35, driftiness: 0.55, startReaction: 0.35, mistakes: 0.2, itemPatience: 0.8, lazyStart: true },
  // heavy kart, generous, holds items as shields
  nonomi: { rivalTier: 0.35, skill: -0.01, lineOffset: -1.0, aggression: 0.45, driftiness: 0.5, startReaction: 0.08, mistakes: 0.2, itemPatience: 0.6 },
  // careful strategist, clean lines
  ayane: { rivalTier: 0.4, skill: 0.01, lineOffset: 0.2, aggression: 0.35, driftiness: 0.7, startReaction: 0.04, mistakes: 0.08, itemPatience: 0.85 },
  // reckless boss: fast, aggressive, crashes more
  aru: { rivalTier: 0.55, skill: -0.02, lineOffset: -0.3, aggression: 0.9, driftiness: 0.9, startReaction: 0.1, mistakes: 0.45, itemPatience: 0.15, recklessness: 0.8 },
  // gamer: item-happy, loves drifting
  arisu: { rivalTier: 0.5, skill: 0.02, lineOffset: 1.2, aggression: 1.0, driftiness: 0.95, startReaction: 0.03, mistakes: 0.2, itemPatience: 0.05 },
  // prefect: very precise, the strongest rival
  hina: { rivalTier: 1.0, skill: 0.06, lineOffset: 0.0, aggression: 0.6, driftiness: 0.95, startReaction: 0.0, mistakes: 0.03, itemPatience: 0.75 },
};

const DEFAULT_PERSONALITY = { skill: 0, lineOffset: 0, aggression: 0.6, driftiness: 0.7, startReaction: 0.05, mistakes: 0.2, itemPatience: 0.5 };

/** Player first, then up to RACERS_PER_RACE-1 unique rivals (all other characters by default). TT: player only. */
export function buildRoster({ mode, playerCharacterId, rivalIds }) {
  const player = getCharacter(playerCharacterId);
  if (mode === 'tt') return [player];
  const ids = Array.isArray(rivalIds) && rivalIds.length ? rivalIds : CHARACTERS.map((c) => c.id);
  const seen = new Set([player.id]);
  const rivals = [];
  for (const id of ids) {
    const c = CHARACTERS.find((ch) => ch.id === id);
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    rivals.push(c);
    if (rivals.length >= RACERS_PER_RACE - 1) break;
  }
  return [player, ...rivals];
}

/**
 * Grid order (slot 0 = pole). Uses `gridOrder` when given (unknown ids dropped, missing racers put at the
 * front so a given back-of-grid player stays at the back); otherwise rivals in roster order, player last.
 */
export function buildGridOrder(roster, gridOrder) {
  const ids = roster.map((c) => c.id);
  if (!Array.isArray(gridOrder) || !gridOrder.length) return [...ids.slice(1), ids[0]];
  const valid = new Set(ids);
  const order = [];
  for (const id of gridOrder) if (valid.has(id) && !order.includes(id)) order.push(id);
  const missing = ids.filter((id) => !order.includes(id));
  return [...missing, ...order];
}

/**
 * AI skill + personality for AIDriver. AIDriver applies its own per-character "flavour" (skill offset and
 * aggression / driftiness multipliers) and the engine's itemAggression on top, so the values here are mild,
 * centred on 1.0 multipliers: aggression 0.8..1.2, driftiness 0.85..1.15, lineOffset in metres.
 */
export function aiProfile(characterId, engine, rng = Math.random, { isPlayer = false } = {}) {
  const base = PERSONALITIES[characterId] || DEFAULT_PERSONALITY;
  const personality = {
    ...base,
    lineOffset: base.lineOffset + (rng() - 0.5) * 1.2,
    aggression: clamp(0.8 + 0.4 * base.aggression + (rng() - 0.5) * 0.06, 0.6, 1.3),
    driftiness: clamp(0.85 + 0.3 * base.driftiness + (rng() - 0.5) * 0.06, 0.7, 1.2),
    rivalScore: (base.rivalTier ?? 0.4) + rng() * 0.8,
  };
  // engine class skill + a slight per-character / per-race variation (AIDriver adds its character flavour)
  let skill = (engine?.aiSkill ?? 0.8) + base.skill * 0.5 + (rng() - 0.5) * 0.03;
  if (isPlayer) {
    // autopilot / post-finish driver for the player's kart: steady, competent, no personality quirks
    skill = Math.max(skill, 0.85);
    personality.lineOffset = 0;
    personality.aggression = 1;
    personality.driftiness = 1;
    personality.mistakes = 0.05;
    personality.startReaction = 0;
    personality.lazyStart = false;
    personality.autopilot = true;
    delete personality.rivalScore;
  }
  return { skill: clamp(skill, 0.05, 1), personality };
}
