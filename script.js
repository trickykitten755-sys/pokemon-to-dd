// ================== RULE TABLES ==================

const STAT_TO_ABILITY = [
  [1, 40, 8],
  [41, 60, 10],
  [61, 80, 12],
  [81, 100, 14],
  [101, 120, 16],
  [121, 140, 18],
  [141, 160, 20],
  [161, 220, 22],
  [221, 999, 25],
];

const TYPE_MAP = {
  normal: "Bludgeoning/Slashing",
  fire: "Fire",
  water: "Cold",
  electric: "Lightning",
  grass: "Poison/Slashing",
  ice: "Cold",
  fighting: "Bludgeoning",
  poison: "Poison",
  ground: "Bludgeoning",
  flying: "Slashing",
  psychic: "Psychic",
  bug: "Piercing",
  rock: "Bludgeoning",
  ghost: "Necrotic",
  dragon: "Force",
  dark: "Necrotic",
  steel: "Slashing",
  fairy: "Radiant",
};

const BASE_POWER_TO_DAMAGE = [
  [0, 40, "1d6"],
  [41, 60, "2d6"],
  [61, 80, "3d6"],
  [81, 100, "4d6"],
  [101, 120, "5d6"],
  [121, 999, "6d6+"],
];

// ================== STATE ==================

let currentPokemon = null;
let currentSpecies = null;
let shiny = false;
let selectedMoves = new Map();

let lastAbilities, lastAC, lastHP, lastAttackBonus, lastBaseBlock;

// ================== HELPERS ==================

const $ = id => document.getElementById(id);

const mod = s => Math.floor((s - 10) / 2);

function convertStat(base) {
  for (const [l, h, s] of STAT_TO_ABILITY) {
    if (base >= l && base <= h) return s;
  }
  return 10;
}

function basePowerToDamage(bp) {
  for (const [l, h, d] of BASE_POWER_TO_DAMAGE) {
    if (bp >= l && bp <= h) return d;
  }
  return null;
}

function toDnDLevel(lv) {
  return Math.min(20, Math.max(1, Math.ceil(lv / 5)));
}

function proficiencyBonus(dl) {
  if (dl >= 17) return 6;
  if (dl >= 13) return 5;
  if (dl >= 9) return 4;
  if (dl >= 5) return 3;
  return 2;
}

function hitDieFromBaseHP(hp) {
  if (hp <= 45) return 6;
  if (hp <= 80) return 8;
  if (hp <= 110) return 10;
  return 12;
}

function calcHP(baseHP, con, pokeLv) {
  const dl = toDnDLevel(pokeLv);
  const die = hitDieFromBaseHP(baseHP);
  const avg = (die / 2) + 0.5;
  return { hp: Math.floor((avg + mod(con)) * dl), die, dl };
}

function calculateCR({ hp, ac, dpr, atk }) {
  const def = hp / 15 + (ac - 13) * 0.6;
  const off = dpr / 6 + atk * 0.35;
  return Math.max(1, Math.min(30, Math.round((def + off) / 2)));
}

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("Fetch failed");
  return r.json();
}

// ================== MOVE HANDLING ==================

async function getMoveDetails(url) {
  const m = await fetchJSON(url);
  return {
    name: m.name.replaceAll("-", " "),
    power: m.power,
    accuracy: m.accuracy,
    type: m.type.name,
    class: m.damage_class.name,
  };
}

function convertMove(m, stabTypes) {
  return {
    ...m,
    dndType: TYPE_MAP[m.type] ?? m.type,
    dice: m.class === "status" ? null : basePowerToDamage(m.power),
    stab: stabTypes.includes(m.type),
  };
}

function estimateDPR(moves) {
  if (!moves.length) return 2;
  const best = moves.find(m => m.dice) ?? moves[0];
  const avg = {
    "1d6": 3.5,
    "2d6": 7,
    "3d6": 10.5,
    "4d6": 14,
    "5d6": 17.5,
    "6d6+": 21,
  }[best.dice] ?? 3.5;
  return avg * 0.65;
}

// ================== MAIN ==================

$("pokeLevel").oninput = e => $("levelLabel").textContent = e.target.value;
$("generateBtn").onclick = generate;
$("shinyBtn").onclick = toggleShiny;
$("copyBtn").onclick = () => navigator.clipboard.writeText($("output").textContent);

async function generate() {
  const name = $("pokemonName").value.trim().toLowerCase();
  const pokeLv = +$("pokeLevel").value;
  if (!name) return;

  selectedMoves.clear();
  $("learnset").innerHTML = "";

  const data = await fetchJSON(`https://pokeapi.co/api/v2/pokemon/${name}`);
  const species = await fetchJSON(data.species.url);

  currentPokemon = data;
  currentSpecies = species;

  $("sprite").src = data.sprites.front_default;
  $("shinyBtn").disabled = false;
  shiny = false;

  const types = data.types.map(t => t.type.name);
  $("badges").innerHTML = types.map(t => `<span>${t} → ${TYPE_MAP[t]}</span>`).join("");

  const entry = species.flavor_text_entries.find(e => e.language.name === "en");
  $("dexEntry").textContent = entry?.flavor_text.replace(/\s+/g, " ") ?? "";

  const base = {};
  data.stats.forEach(s => base[s.stat.name] = s.base_stat);

  let abilities = {
    STR: convertStat(base.attack),
    DEX: convertStat(base.speed),
    CON: convertStat(base.defense),
    INT: convertStat(base["special-attack"]),
    WIS: convertStat(base["special-defense"]),
    CHA: 10,
  };

  const ac = 10 + mod(abilities.DEX) + (types.includes("rock") || types.includes("steel") ? 2 : 0);
  const hpInfo = calcHP(base.hp, abilities.CON, pokeLv);
  const prof = proficiencyBonus(hpInfo.dl);
  const atkBonus = prof + Math.max(mod(abilities.STR), mod(abilities.DEX), mod(abilities.INT));

  lastAbilities = abilities;
  lastAC = ac;
  lastHP = hpInfo.hp;
  lastAttackBonus = atkBonus;

  lastBaseBlock =
`Name: ${data.name.toUpperCase()} (Lv ${pokeLv})
Types: ${types.join(", ")}

AC ${ac}
HP ${hpInfo.hp} (${hpInfo.dl}d${hpInfo.die})

STR ${abilities.STR} (${mod(abilities.STR)})
DEX ${abilities.DEX} (${mod(abilities.DEX)})
CON ${abilities.CON} (${mod(abilities.CON)})
INT ${abilities.INT} (${mod(abilities.INT)})
WIS ${abilities.WIS} (${mod(abilities.WIS)})
CHA ${abilities.CHA} (${mod(abilities.CHA)})`;

  renderLearnset(data.moves, pokeLv, types);
  updateOutput();
}

function renderLearnset(moves, pokeLv, stabTypes) {
  const rows = [];

  for (const m of moves) {
    const v = m.version_group_details.find(v =>
      v.move_learn_method.name === "level-up" &&
      v.level_learned_at <= pokeLv
    );
    if (!v) continue;

    rows.push({ name: m.move.name, url: m.move.url, lv: v.level_learned_at });
  }

  rows.sort((a, b) => a.lv - b.lv);

  $("learnset").innerHTML = rows.map(r => `
    <label class="learnRow">
      <span>Lv ${r.lv}</span>
      <input type="checkbox" data-url="${r.url}" data-name="${r.name}">
      ${r.name.replaceAll("-", " ")}
    </label>
  `).join("");

  $("learnset").querySelectorAll("input").forEach(cb => {
    cb.onchange = async e => {
      const name = e.target.dataset.name;
      if (e.target.checked) {
        if (selectedMoves.size >= 6) {
          e.target.checked = false;
          return;
        }
        const md = await getMoveDetails(e.target.dataset.url);
        selectedMoves.set(name, convertMove(md, stabTypes));
      } else {
        selectedMoves.delete(name);
      }
      updateOutput();
    };
  });
}

function updateOutput() {
  const moves = [...selectedMoves.values()];
  const dpr = estimateDPR(moves);
  const cr = calculateCR({ hp: lastHP, ac: lastAC, dpr, atk: lastAttackBonus });

  const moveText = moves.length
    ? moves.map(m =>
        `• ${m.name} — ${m.class === "status" ? "Status" : m.dice} | ${m.dndType}`
      ).join("\n")
    : "• (No moves selected)";

  $("output").textContent =
`${lastBaseBlock}

Attack Bonus: +${lastAttackBonus}
Estimated DPR: ${dpr.toFixed(1)}
Estimated CR: ${cr}

Moves
${moveText}`;

  $("copyBtn").disabled = false;
}

function toggleShiny() {
  if (!currentPokemon) return;
  shiny = !shiny;
  $("sprite").src = shiny
    ? currentPokemon.sprites.front_shiny
    : currentPokemon.sprites.front_default;
}
