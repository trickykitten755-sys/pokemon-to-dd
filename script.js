const STAT_TO_ABILITY = [
  [1, 40, 8],
  [41, 60, 10],
  [61, 80, 12],
  [81, 100, 14],
  [101, 120, 16],
  [121, 140, 18],
  [141, 160, 20],
  [161, 220, 22],
  [221, 999, 25]
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
  fairy: "Radiant"
};

// === Helper Functions ===

function convertStat(base) {
  for (let [low, high, score] of STAT_TO_ABILITY) {
    if (base >= low && base <= high) return score;
  }
  return 10;
}

function mod(score) {
  return Math.floor((score - 10) / 2);
}
// === Main Generator ===

async function generate() {
  const input = document.getElementById("pokemonName").value.trim().toLowerCase();
  const output = document.getElementById("output");

  if (!input) {
    output.textContent = "Please enter a Pokémon name.";
    return;
  }

  try {
    const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${input}`);
    if (!res.ok) throw new Error("Pokémon not found");

    const data = await res.json();

    const stats = {};
    data.stats.forEach(s => stats[s.stat.name] = s.base_stat);

    const abilities = {
      STR: convertStat(stats.attack),
      DEX: convertStat(stats.speed),
      CON: convertStat(stats.defense),
      INT: convertStat(stats["special-attack"]),
      WIS: convertStat(stats["special-defense"]),
      CHA: 10
    };

    let ac = 10 + mod(abilities.DEX);

    const types = data.types.map(t => t.type.name);
    const dmgTypes = types.map(t => TYPE_MAP[t] ?? "Unknown");

    output.textContent =
`Name: ${data.name.toUpperCase()}
Types: ${types.join(", ")}
Damage Types: ${dmgTypes.join(", ")}
Armor Class: ${ac}

STR ${abilities.STR} (${mod(abilities.STR)})
DEX ${abilities.DEX} (${mod(abilities.DEX)})
CON ${abilities.CON} (${mod(abilities.CON)})
INT ${abilities.INT} (${mod(abilities.INT)})
WIS ${abilities.WIS} (${mod(abilities.WIS)})
CHA ${abilities.CHA} (${mod(abilities.CHA)})`;

  } catch (err) {
    output.textContent = "Error: Pokémon not found or API issue.";
  }
}

