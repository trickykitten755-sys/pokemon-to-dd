// =========================
// Conversion Rules (yours)
// =========================

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

// -------------------------
// UI elements
// -------------------------

const elName = document.getElementById("pokemonName");
const elLevel = document.getElementById("pokeLevel");
const elLevelLabel = document.getElementById("levelLabel");
const elVersion = document.getElementById("versionGroup");
const elGenerate = document.getElementById("generateBtn");
const elShiny = document.getElementById("shinyBtn");
const elCopy = document.getElementById("copyBtn");
const elStatus = document.getElementById("status");

const elSprite = document.getElementById("sprite");
const elTitle = document.getElementById("title");
const elBadges = document.getElementById("badges");
const elDexEntry = document.getElementById("dexEntry");
const elOutput = document.getElementById("output");
const elLearnset = document.getElementById("learnset");

let currentPokemon = null;
let currentSpecies = null;
let shiny = false;

// -------------------------
// Helpers
// -------------------------

function setStatus(msg, kind = "info") {
  elStatus.textContent = msg;
  elStatus.style.color = kind === "bad" ? "var(--bad)" : kind === "good" ? "var(--good)" : "var(--muted)";
}

function normalizeName(s) {
  return s.trim().toLowerCase();
}

function convertStat(base) {
  for (const [low, high, score] of STAT_TO_ABILITY) {
    if (base >= low && base <= high) return score;
  }
  return 10;
}

function mod(score) {
  return Math.floor((score - 10) / 2);
}

function basePowerToDamage(bp) {
  if (bp == null) return null;
  for (const [low, high, dmg] of BASE_POWER_TO_DAMAGE) {
    if (bp >= low && bp <= high) return dmg;
  }
  return "1d6";
}

// Pokémon level (1–100) mapped to a D&D-ish level (1–20) so bounded math stays sane.
function toDnDLevel(pokeLevel) {
  return Math.min(20, Math.max(1, Math.ceil(pokeLevel / 5)));
}

function proficiencyBonus(dndLevel) {
  // Standard 5e progression, capped at 6.
  if (dndLevel >= 17) return 6;
  if (dndLevel >= 13) return 5;
  if (dndLevel >= 9) return 4;
  if (dndLevel >= 5) return 3;
  return 2;
}

function hpHitDieFromBaseHP(baseHp) {
  // Simple, DM-friendly mapping. You can tweak easily.
  if (baseHp <= 45) return 6;      // frail
  if (baseHp <= 80) return 8;      // average
  if (baseHp <= 110) return 10;    // tough
  return 12;                       // very tough+
}

function averageDie(d) {
  return (d / 2) + 0.5;
}

function calcHP(baseHp, conScore, pokeLevel) {
  const dndLevel = toDnDLevel(pokeLevel);
  const die = hpHitDieFromBaseHP(baseHp);
  const conMod = mod(conScore);
  const perLevel = Math.max(1, Math.floor(averageDie(die) + conMod));
  return {
    dndLevel,
    hitDie: `d${die}`,
    hp: perLevel * dndLevel,
  };
}

function pickVersionGroup(availableGroups) {
  // Prefer newer if present
  const preferred = ["scarlet-violet", "sword-shield", "sun-moon", "ultra-sun-ultra-moon", "x-y", "omega-ruby-alpha-sapphire"];
  for (const p of preferred) if (availableGroups.includes(p)) return p;
  return availableGroups[availableGroups.length - 1] || "";
}

function dedupeByName(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (seen.has(item.name)) continue;
    seen.add(item.name);
    out.push(item);
  }
  return out;
}

// “Stats as it levels up” — bounded, simple, campaign-friendly.
// At Pokémon levels 20/40/60/80, the TWO highest ability scores each gain +1 (max 25).
function applyLevelUps(abilities, pokeLevel) {
  const milestones = [20, 40, 60, 80];
  const ups = milestones.filter(m => pokeLevel >= m).length; // 0..4
  if (ups === 0) return abilities;

  // Find two highest (excluding CHA, unless you want it to grow too)
  const keys = Object.keys(abilities).filter(k => k !== "CHA");
  keys.sort((a, b) => abilities[b] - abilities[a]);

  const top2 = keys.slice(0, 2);
  const out = { ...abilities };

  for (let i = 0; i < ups; i++) {
    for (const k of top2) {
      out[k] = Math.min(25, out[k] + 1);
    }
  }
  return out;
}

// CR heuristic: uses HP/AC and rough DPR from best converted moves.
// This is intentionally “DM-useful” not “official”.
function calculateCR({ hp, ac, bestDpr, attackBonus }) {
  const defensive = (hp / 15) + ((ac - 13) * 0.6);
  const offensive = (bestDpr / 6) + (attackBonus * 0.35);
  const raw = Math.round((defensive + offensive) / 2);
  return Math.max(1, Math.min(raw, 30));
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${url}`);
  return await res.json();
}

// -------------------------
// Move conversion + learnset
// -------------------------

async function getMoveDetails(moveUrl) {
  const mv = await fetchJson(moveUrl);
  return {
    name: mv.name,
    power: mv.power,
    accuracy: mv.accuracy,
    type: mv.type?.name ?? "unknown",
    damageClass: mv.damage_class?.name ?? "status", // physical/special/status
  };
}

function convertMoveToDnD(move, stabTypes) {
  const dndType = TYPE_MAP[move.type] ?? move.type;
  const dmgDice = move.damageClass === "status" ? null : basePowerToDamage(move.power);

  // Optional spice: mark STAB (same-type attack bonus) as +1 die step in your head
  const isStab = stabTypes.includes(move.type);

  return {
    name: move.name.replaceAll("-", " "),
    type: move.type,
    dndType,
    damageClass: move.damageClass,
    power: move.power,
    accuracy: move.accuracy,
    dmgDice,
    isStab,
  };
}

function formatMoveLine(m) {
  const parts = [];
  if (m.damageClass === "status") {
    parts.push("Status");
  } else {
    parts.push(m.dmgDice ?? "—");
  }
  if (m.accuracy != null) parts.push(`${m.accuracy}%`);
  parts.push(m.dndType);
  if (m.isStab && m.damageClass !== "status") parts.push("STAB");
  return `• ${m.name} — ${parts.join(" | ")}`;
}

function extractVersionGroupsFromMoves(moves) {
  const groups = new Set();
  for (const m of moves) {
    for (const vgd of m.version_group_details) {
      groups.add(vgd.version_group.name);
    }
  }
  return Array.from(groups).sort();
}

function buildLearnset(moves, versionGroup, pokeLevel) {
  // Only level-up moves for the selected version group, learned at or below pokeLevel.
  const out = [];

  for (const m of moves) {
    const vgd = m.version_group_details.find(x => x.version_group.name === versionGroup);
    if (!vgd) continue;

    if (vgd.move_learn_method.name !== "level-up") continue;
    const lv = vgd.level_learned_at ?? 0;
    if (lv > pokeLevel) continue;

    out.push({
      name: m.move.name,
      level: lv,
      url: m.move.url,
    });
  }

  out.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  return out;
}

async function pickConvertedMoves(learnset, stabTypes, count = 6) {
  // Prefer damaging moves with power. Limit fetches for speed.
  // We'll check the most recent learned moves first.
  const reversed = [...learnset].sort((a, b) => b.level - a.level);
  const candidates = reversed.slice(0, 18); // limit API calls

  const detailed = [];
  for (const c of candidates) {
    try {
      const md = await getMoveDetails(c.url);
      const conv = convertMoveToDnD(md, stabTypes);
      detailed.push(conv);
    } catch {
      // ignore a move if it errors
    }
  }

  // Prefer non-status, higher power
  detailed.sort((a, b) => {
    const ap = a.power ?? 0;
    const bp = b.power ?? 0;
    const aStatus = a.damageClass === "status";
    const bStatus = b.damageClass === "status";
    if (aStatus !== bStatus) return aStatus ? 1 : -1;
    return bp - ap;
  });

  const chosen = dedupeByName(detailed).slice(0, count);
  return chosen;
}

function estimateDPR(convertedMoves, attackBonus) {
  // SUPER rough: take best damage move and assume it hits ~65% of the time.
  // Uses average of dice: 1d6=3.5, 2d6=7, ..., 6d6+=21+.
  const dmgMoves = convertedMoves.filter(m => m.damageClass !== "status" && m.dmgDice);
  if (dmgMoves.length === 0) return 2;

  const best = dmgMoves[0];

  const avg = (() => {
    const s = best.dmgDice;
    if (s === "1d6") return 3.5;
    if (s === "2d6") return 7;
    if (s === "3d6") return 10.5;
    if (s === "4d6") return 14;
    if (s === "5d6") return 17.5;
    if (s === "6d6+") return 21; // conservative
    return 3.5;
  })();

  const hitChance = 0.65; // baseline
  // add a tiny bump for higher attack bonus (bounded)
  const bump = Math.max(-0.1, Math.min(0.1, (attackBonus - 5) * 0.02));
  return avg * (hitChance + bump);
}

// -------------------------
// Pokédex entry
// -------------------------

function pickDexEntry(speciesData, versionGroup) {
  const entries = speciesData.flavor_text_entries || [];
  const english = entries.filter(e => e.language?.name === "en");

  // If we have a version group, prefer entries from versions in that group.
  if (versionGroup) {
    // versionGroup is like "scarlet-violet"; species entries have "version.name" like "scarlet"
    const [a, b] = versionGroup.split("-");
    const preferredVersions = new Set([a, b].filter(Boolean));
    const vgMatches = english.filter(e => preferredVersions.has(e.version?.name));
    if (vgMatches.length) return normalizeFlavor(vgMatches[vgMatches.length - 1].flavor_text);
  }

  // Else pick the latest English entry available
  if (english.length) return normalizeFlavor(english[english.length - 1].flavor_text);
  return "No Pokédex entry found.";
}

function normalizeFlavor(s) {
  return (s || "").replaceAll("\f", " ").replaceAll("\n", " ").replace(/\s+/g, " ").trim();
}

// -------------------------
// Main generator
// -------------------------

elLevel.addEventListener("input", () => {
  elLevelLabel.textContent = elLevel.value;
});

elGenerate.addEventListener("click", generate);
elShiny.addEventListener("click", toggleShiny);
elCopy.addEventListener("click", copyBlock);

async function generate() {
  const name = normalizeName(elName.value);
  const pokeLevel = parseInt(elLevel.value, 10);
  const output = elOutput;

  if (!name) {
    setStatus("Please enter a Pokémon name.", "bad");
    return;
  }

  setStatus("Fetching data…");
  disableButtons();

  try {
    const data = await fetchJson(`https://pokeapi.co/api/v2/pokemon/${name}`);
    currentPokemon = data;

    // Species endpoint for Pokédex entry
    const species = await fetchJson(data.species.url);
    currentSpecies = species;

    // Populate version group dropdown based on this Pokémon’s move learn data
    const groups = extractVersionGroupsFromMoves(data.moves);
    populateVersionGroups(groups);

    const chosenGroup = elVersion.value || pickVersionGroup(groups);
    if (!elVersion.value && chosenGroup) elVersion.value = chosenGroup;

    // Sprites
    shiny = false;
    elSprite.src = data.sprites.front_default || "";
    elShiny.disabled = !data.sprites.front_default;

    // Title + badges
    elTitle.textContent = `${data.name.toUpperCase()} (Lv ${pokeLevel})`;
    const types = data.types.map(t => t.type.name);
    elBadges.innerHTML = "";
    for (const t of types) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = `${t.toUpperCase()} → ${TYPE_MAP[t] ?? t}`;
      elBadges.appendChild(badge);
    }

    // Pokédex entry
    elDexEntry.textContent = pickDexEntry(species, chosenGroup);

    // Base stats (Pokémon)
    const baseStats = {};
    data.stats.forEach(s => baseStats[s.stat.name] = s.base_stat);

    // Convert to abilities (your mapping idea, bounded)
    const baseAbilities = {
      STR: convertStat(baseStats.attack),
      DEX: convertStat(baseStats.speed),
      CON: convertStat(baseStats.defense),
      INT: convertStat(baseStats["special-attack"]),
      WIS: convertStat(baseStats["special-defense"]),
      CHA: 10,
    };

    // Apply level-up scaling
    const abilities = applyLevelUps(baseAbilities, pokeLevel);

    // AC (your formula) + tiny natural armor bump for rock/steel
    let ac = 10 + mod(abilities.DEX);
    if (types.includes("rock") || types.includes("steel")) ac += 2;

    // HP scaling + hit dice
    const hpInfo = calcHP(baseStats.hp, abilities.CON, pokeLevel);

    // Proficiency based on D&D-equivalent level
    const prof = proficiencyBonus(hpInfo.dndLevel);

    // Learnset + converted moves
    const learnset = buildLearnset(data.moves, chosenGroup, pokeLevel);
    renderLearnset(learnset);

    const convertedMoves = await pickConvertedMoves(learnset, types, 6);

    // Attack bonus: pick best of STR/DEX/INT depending on physical/special. We'll estimate using max mod.
    const bestMod = Math.max(mod(abilities.STR), mod(abilities.DEX), mod(abilities.INT));
    const attackBonus = prof + bestMod;

    // CR estimate
    const bestDpr = estimateDPR(convertedMoves, attackBonus);
    const cr = calculateCR({ hp: hpInfo.hp, ac, bestDpr, attackBonus });

    // Output stat block (D&D-ish, pasteable)
    const dmgTypes = types.map(t => TYPE_MAP[t] ?? t).join(", ");

    const moveLines = convertedMoves.length
      ? convertedMoves.map(formatMoveLine).join("\n")
      : "• (No level-up moves found for this version group at this level.)";

    output.textContent =
`Name: ${data.name.toUpperCase()}
Pokémon Level: ${pokeLevel}  |  D&D Level: ${hpInfo.dndLevel}  |  Proficiency: +${prof}
Types: ${types.join(", ")}  |  Damage Types: ${dmgTypes}

Armor Class: ${ac}
Hit Points: ${hpInfo.hp} (${hpInfo.dndLevel}${hpInfo.hitDie} + CON)
Speed: ${Math.max(10, 25 + mod(abilities.DEX) * 5)} ft (suggested)

Ability Scores
STR ${abilities.STR} (${mod(abilities.STR) >= 0 ? "+" : ""}${mod(abilities.STR)})
DEX ${abilities.DEX} (${mod(abilities.DEX) >= 0 ? "+" : ""}${mod(abilities.DEX)})
CON ${abilities.CON} (${mod(abilities.CON) >= 0 ? "+" : ""}${mod(abilities.CON)})
INT ${abilities.INT} (${mod(abilities.INT) >= 0 ? "+" : ""}${mod(abilities.INT)})
WIS ${abilities.WIS} (${mod(abilities.WIS) >= 0 ? "+" : ""}${mod(abilities.WIS)})
CHA ${abilities.CHA} (${mod(abilities.CHA) >= 0 ? "+" : ""}${mod(abilities.CHA)})

Suggested Attack Bonus: +${attackBonus}
Estimated Best DPR: ~${bestDpr.toFixed(1)}
Estimated CR (heuristic): ${cr}

Moves (converted)
${moveLines}
`;

    enableButtons();
    setStatus(`Done. Learnset from version group: ${chosenGroup}`, "good");

  } catch (err) {
    console.error(err);
    setStatus("Error: Pokémon not found (or PokéAPI issue). Check spelling (e.g., mr-mime).", "bad");
    clearCard();
  }
}

function populateVersionGroups(groups) {
  const cur = elVersion.value;
  const options = [`<option value="">(auto)</option>`]
    .concat(groups.map(g => `<option value="${g}">${g}</option>`))
    .join("");
  elVersion.innerHTML = options;
  // keep previous if still valid
  if (cur && groups.includes(cur)) elVersion.value = cur;
}

function renderLearnset(learnset) {
  if (!learnset.length) {
    elLearnset.innerHTML = `<div class="learnRow"><div class="lv">—</div><div class="moveName">No level-up moves</div><div class="moveMeta">—</div></div>`;
    return;
  }

  const rows = learnset.map(m => {
    const name = m.name.replaceAll("-", " ");
    return `
      <div class="learnRow">
        <div class="lv">Lv ${m.level}</div>
        <div class="moveName">${escapeHtml(name)}</div>
        <div class="moveMeta">level-up</div>
      </div>
    `;
  }).join("");

  elLearnset.innerHTML = rows;
}

function escapeHtml(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// -------------------------
// Buttons / utilities
// -------------------------

function disableButtons() {
  elGenerate.disabled = true;
  elCopy.disabled = true;
  elShiny.disabled = true;
}

function enableButtons() {
  elGenerate.disabled = false;
  elCopy.disabled = false;
  elShiny.disabled = false;
}

function clearCard() {
  elTitle.textContent = "—";
  elBadges.innerHTML = "";
  elDexEntry.textContent = "Pokédex entry will appear here.";
  elSprite.src = "";
  elOutput.textContent = "";
  elLearnset.innerHTML = "";
  disableButtons();
  elGenerate.disabled = false;
}

function toggleShiny() {
  if (!currentPokemon) return;
  shiny = !shiny;
  const normal = currentPokemon.sprites.front_default;
  const sh = currentPokemon.sprites.front_shiny;
  elSprite.src = shiny ? (sh || normal) : normal;
}

async function copyBlock() {
  const text = elOutput.textContent || "";
  if (!text.trim()) return;

  try {
    await navigator.clipboard.writeText(text);
    setStatus("Copied stat block to clipboard.", "good");
  } catch {
    setStatus("Copy failed (browser permissions). You can still select and copy manually.", "bad");
  }
}

// Regenerate when version group changes (if we already have a Pokémon loaded)
elVersion.addEventListener("change", () => {
  if (currentPokemon) generate();
});
