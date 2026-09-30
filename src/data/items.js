// Item catalogue (Blue Archive flavoured takes on the classic kart-racer items).
//
//   kind:
//     'boost'      - instant speed boost (uses = number of boosts)
//     'boostTimed' - unlimited boosts on button press for `duration` seconds
//     'drop'       - hazard dropped behind (or tossed forward if throttle+up held); can be held behind as a shield
//     'projectile' - fired straight, bounces off walls (`bounces`)
//     'homing'     - homes on the racer directly ahead
//     'throwable'  - lobbed forward in an arc, explodes (blast radius)
//     'invincible' - invincibility + speed for `duration`
//     'global'     - affects every rival (shrink)
//     'leader'     - flies to 1st place and explodes
//     'coins'      - instantly grants credits
//     'decoy'      - fake item box dropped behind
//
//   uses: how many times the item can be used (triple items = 3). Triple projectiles orbit the kart.
//   color: primary icon color (HUD draws the icon, see src/ui/itemIcons.js)

export const ITEMS = {
  drink: {
    id: 'drink',
    name: 'Energy Drink',
    desc: 'A can of pure caffeine. Instant speed boost!',
    kind: 'boost',
    uses: 1,
    color: '#ffcf33',
  },
  drink3: {
    id: 'drink3',
    name: 'Triple Energy Drink',
    desc: 'Three boosts in a six-pack ring.',
    kind: 'boost',
    uses: 3,
    color: '#ffcf33',
  },
  card: {
    id: 'card',
    name: "Sensei's Card",
    desc: 'Swipe as often as you like for a few seconds - unlimited boosts!',
    kind: 'boostTimed',
    uses: 1,
    duration: 7,
    color: '#ffd23f',
  },
  ramen: {
    id: 'ramen',
    name: 'Spilled Ramen',
    desc: 'A slippery bowl of Shibaseki ramen. Drop it behind you.',
    kind: 'drop',
    uses: 1,
    color: '#f6a23c',
  },
  ramen3: {
    id: 'ramen3',
    name: 'Triple Ramen',
    desc: 'Three bowls trailing behind you.',
    kind: 'drop',
    uses: 3,
    color: '#f6a23c',
  },
  bullet: {
    id: 'bullet',
    name: 'Ricochet Round',
    desc: 'Fires straight ahead and bounces off walls.',
    kind: 'projectile',
    uses: 1,
    bounces: 5,
    color: '#4cd964',
  },
  bullet3: {
    id: 'bullet3',
    name: 'Triple Ricochet',
    desc: 'Three rounds orbiting your kart.',
    kind: 'projectile',
    uses: 3,
    bounces: 5,
    color: '#4cd964',
  },
  missile: {
    id: 'missile',
    name: 'Drone Missile',
    desc: "Shiroko's drone locks on to the racer ahead of you.",
    kind: 'homing',
    uses: 1,
    color: '#ff4040',
  },
  missile3: {
    id: 'missile3',
    name: 'Triple Drone Missile',
    desc: 'Three homing missiles orbiting your kart.',
    kind: 'homing',
    uses: 3,
    color: '#ff4040',
  },
  grenade: {
    id: 'grenade',
    name: 'Grenade',
    desc: 'Lob it forward. Big boom!',
    kind: 'throwable',
    uses: 1,
    blastRadius: 7,
    color: '#5b6b3a',
  },
  halo: {
    id: 'halo',
    name: 'Halo Overdrive',
    desc: 'Your halo blazes: invincible and faster for a while.',
    kind: 'invincible',
    uses: 1,
    duration: 7.5,
    color: '#ffe66d',
  },
  tablet: {
    id: 'tablet',
    name: 'Shittim Tablet',
    desc: 'Arona zaps every rival - they drop their items and shrink!',
    kind: 'global',
    uses: 1,
    color: '#35c8ff',
  },
  seeker: {
    id: 'seeker',
    name: 'Blue Seeker',
    desc: 'A winged missile that hunts down the leader.',
    kind: 'leader',
    uses: 1,
    blastRadius: 9,
    color: '#1f6bff',
  },
  credits: {
    id: 'credits',
    name: 'Credit Bag',
    desc: '+3 Credits. More credits, more top speed.',
    kind: 'coins',
    uses: 1,
    amount: 3,
    color: '#ffd23f',
  },
  decoy: {
    id: 'decoy',
    name: 'Decoy Box',
    desc: 'Looks like an item box. It is not.',
    kind: 'decoy',
    uses: 1,
    color: '#ff5fa2',
  },
};

export const ITEM_IDS = Object.keys(ITEMS);

/**
 * Item odds by race position (index 0 = 1st place ... index 7 = 8th place).
 * Relative weights; items with 0 weight never appear at that position.
 */
export const ITEM_ODDS = [
  // 1st
  { ramen: 30, bullet: 22, credits: 22, decoy: 12, ramen3: 8, bullet3: 6 },
  // 2nd
  { ramen: 16, bullet: 18, missile: 14, drink: 12, credits: 10, decoy: 8, ramen3: 8, bullet3: 8, grenade: 6 },
  // 3rd
  { ramen: 8, bullet: 14, missile: 20, drink: 16, bullet3: 12, grenade: 10, credits: 6, missile3: 6, decoy: 4, drink3: 4 },
  // 4th
  { bullet: 8, missile: 18, drink: 18, bullet3: 12, missile3: 12, grenade: 10, drink3: 10, tablet: 2, card: 4, halo: 3, seeker: 3 },
  // 5th
  { missile: 14, drink: 16, missile3: 16, drink3: 18, card: 10, halo: 8, grenade: 6, bullet3: 6, seeker: 4, tablet: 2 },
  // 6th
  { drink: 12, missile3: 16, drink3: 22, card: 16, halo: 14, seeker: 6, tablet: 4, missile: 10 },
  // 7th
  { drink3: 24, card: 20, halo: 22, missile3: 12, seeker: 8, tablet: 6, drink: 8 },
  // 8th
  { drink3: 22, card: 22, halo: 26, missile3: 8, seeker: 10, tablet: 12 },
];

/** Time Trial: the player starts holding a triple drink and item boxes are disabled. */
export const TIME_TRIAL_ITEM = 'drink3';
