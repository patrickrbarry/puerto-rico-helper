// --- Simple in-memory session state (persists while page is open) ---
const sessionState = {
  extraPlantations: [], // your plantations beyond starting
  buildings: []         // names of buildings you own
};

// --- Building definitions (early-game focus) ---
const BUILDINGS = [
  {
    name: "Small Indigo Plant",
    type: "production",
    crop: "Indigo",
    cost: 1,
    baseValue: 3.0
  },
  {
    name: "Sugar Mill",
    type: "production",
    crop: "Sugar",
    cost: 2,
    baseValue: 3.2
  },
  {
    name: "Small Market",
    type: "violet",
    crop: null,
    cost: 1,
    baseValue: 2.5
  },
  {
    name: "Hacienda",
    type: "violet",
    crop: null,
    cost: 2,
    baseValue: 2.8
  }
];

// --- Scoring constants & helpers ---

// Base values reflect that:
// - Corn is still the best raw economy starter
// - Sugar / other higher-value goods are strong once buildings are in place
// - Indigo is weaker unless paired with its production building
const PLANTATION_VALUES_BASE = {
  Corn: 3.1,
  Sugar: 2.8,
  Indigo: 1.8,
  Tobacco: 2.4,
  Coffee: 2.3
};

function plantationSynergyBonus(plantation, playerBoard) {
  let bonus = 0;

  // Synergy for matching starting crop depends on which crop it is.
  if (plantation === playerBoard.startingPlantation) {
    if (plantation === "Corn") {
      // Corn dupe is very strong in 2p shipping pressure.
      bonus += 0.9;
    } else if (plantation === "Indigo") {
      // Matching indigo is only a mild boost – often prefer better goods or Builder.
      bonus += 0.2;
    } else {
      // Other crops: moderate synergy
      bonus += 0.6;
    }
  }

  const all = [playerBoard.startingPlantation, ...playerBoard.extraPlantations];
  const uniqueTypes = new Set(all);

  if (!uniqueTypes.has(plantation)) {
    // Early diversification is nice, especially for Indigo starter.
    bonus += 0.5;
  }

  return bonus;
}

function plantationDenyBonus(plantation, opponentBoard) {
  let bonus = 0;
  if (plantation === opponentBoard.startingPlantation) {
    // Denying more corn to a Corn starter, or more indigo to Indigo starter, has some value.
    bonus += 0.4;
  }
  return bonus;
}

function scorePlantationChoice(plantation, you, opponent, context) {
  const base = PLANTATION_VALUES_BASE[plantation] || 0;
  const synergy = plantationSynergyBonus(plantation, you);
  const deny = plantationDenyBonus(plantation, opponent);

  // Earlier picks in the round have slightly more shaping power.
  const earlyTurnBonus = context.turnNumber <= 2 ? 0.4 : 0;

  return base + synergy + deny + earlyTurnBonus;
}

function describePlantationReason(plantation, you, opponent) {
  const parts = [];

  if (plantation === "Corn") {
    parts.push("Corn is extremely strong early because it produces without a building and gives fast shipping pressure in 2-player.");
  } else if (plantation === "Indigo") {
    parts.push("Indigo is weaker economically than corn; it mainly shines once you have the matching indigo production building.");
  } else if (plantation === "Sugar") {
    parts.push("Sugar is a higher-value good that scores well once the Sugar Mill is in place, making it an appealing early pick.");
  } else {
    parts.push(`${plantation} is a high-value export that pays off once the right production building is online.`);
  }

  if (plantation === you.startingPlantation) {
    parts.push("It matches your starting plantation, reinforcing that production line.");
  } else {
    parts.push("It diversifies your plantations, giving you more flexibility later.");
  }

  if (plantation === opponent.startingPlantation) {
    parts.push("It also denies the opponent another copy of their main crop.");
  }

  return parts.join(" ");
}

// --- Builder logic: score specific buildings ---

function hasBuilding(buildings, name) {
  return buildings.includes(name);
}

function countPlantationType(playerBoard, type) {
  return [playerBoard.startingPlantation, ...playerBoard.extraPlantations].filter(
    p => p === type
  ).length;
}

function scoreBuildingChoice(building, you, context) {
  // Don't recommend duplicates of small buildings (1 copy in 2p)
  if (hasBuilding(you.buildings, building.name)) {
    return -999; // effectively "do not recommend"
  }

  let score = building.baseValue;

  // Production synergy
  if (building.type === "production" && building.crop) {
    const n = countPlantationType(you, building.crop);
    if (n > 0) {
      // You already have plantations of this crop: big synergy.
      score += 1.5 + 0.3 * (n - 1);
    } else if (building.crop === you.startingPlantation) {
      // No extra plantations yet but matches starting crop.
      score += 1.0;
    }
  }

  // Small Market: better if you have multiple production lines.
  if (building.name === "Small Market") {
    const uniquePlantTypes = new Set([
      you.startingPlantation,
      ...you.extraPlantations
    ]);
    if (uniquePlantTypes.size >= 2) score += 0.7;
  }

  // Hacienda: better early when you will still take more Settlers.
  if (building.name === "Hacienda") {
    if (context.turnNumber <= 3) score += 0.8;
  }

  // Slight penalty for spending more early money (opportunity cost)
  score -= building.cost * 0.2;

  return score;
}

function getBuilderOptions(you, context) {
  // Only consider buildings you can afford for now.
  return BUILDINGS
    .filter(b => b.cost <= you.doubloons)
    .map(building => {
      const score = scoreBuildingChoice(building, you, context);
      return { building, score };
    })
    .filter(opt => opt.score > -500) // filter out "do not recommend"
    .sort((a, b) => b.score - a.score);
}

// --- Non-Settler role heuristics ---

function scoreProspector(you, context) {
  let score = 2.0;
  if (you.doubloons <= 2) score += 0.7;
  if (context.turnNumber <= 2) score -= 0.2; // early you often want strong plantation or Builder first
  return score;
}

function explainProspector(you, context) {
  const bits = [];
  bits.push("Prospector gives you an extra doubloon, improving early buying power for key buildings.");
  if (you.doubloons <= 2) {
    bits.push("Because your money is low, the extra coin is especially attractive.");
  }
  if (context.turnNumber >= 3) {
    bits.push("Later in the round, some strong plantations may already be gone, making money comparatively better.");
  }
  return bits.join(" ");
}

function scoreBuilderRole(you, context) {
  const options = getBuilderOptions(you, context);
  if (options.length === 0) return 0.5; // not great if you can't buy anything meaningful
  // Use best building option as proxy
  const best = options[0].score;
  return best + 0.2; // small bump for the flexibility of choosing buildings
}

function explainBuilderRole(you, context) {
  const bits = [];
  bits.push("Builder lets you convert your doubloons into long-term engine pieces.");
  if (you.doubloons >= 3) {
    bits.push("With 3+ doubloons, you can often buy a key early building like a production plant or Hacienda.");
  } else {
    bits.push("With limited money, your options are narrower, but cheap buildings like Small Indigo Plant or Small Market may still be attractive.");
  }
  if (context.turnNumber <= 3) {
    bits.push("Doing this early sets up production and shipping before your opponent fully spins up.");
  }
  return bits.join(" ");
}

function scoreOtherRole(role, you, context) {
  const plantCount = [you.startingPlantation, ...you.extraPlantations].length;
  const hasAnyBuilding = you.buildings.length > 0;

  switch (role) {
    case "Mayor":
      // Better once you actually have stuff to staff
      return hasAnyBuilding || plantCount > 1 ? 1.2 : 0.6;
    case "Craftsman":
      // Better if you have at least one production pair (rough heuristic)
      return hasAnyBuilding ? 1.0 : 0.4;
    case "Trader":
      // Better once you can produce higher-value goods, but we don't
      // model goods yet, so keep modest.
      return 0.7;
    case "Captain":
      // Rarely great this early, but slightly better with multiple crops.
      return plantCount >= 2 ? 0.6 : 0.2;
    default:
      return 0.3;
  }
}

function explainOtherRole(role, you, context) {
  const plantCount = [you.startingPlantation, ...you.extraPlantations].length;
  const hasAnyBuilding = you.buildings.length > 0;

  switch (role) {
    case "Mayor":
      if (hasAnyBuilding || plantCount > 1) {
        return "Mayor can be reasonable now because you have enough plantations/buildings to justify extra colonists, but it's still usually secondary to Settler/Builder openings.";
      }
      return "Mayor can help place colonists, but very early you usually have few buildings or plantations to staff, so it’s rarely the best opening pick.";
    case "Craftsman":
      if (hasAnyBuilding) {
        return "Craftsman becomes more attractive once you have production buildings, but in very early turns it often lags behind strong Settler or Builder plays.";
      }
      return "Craftsman is rarely strong in the very first round before a larger production engine is online.";
    case "Trader":
      return "Trader tends to be low-impact in the opening when there are few goods to sell, but can set up a small cash injection when production ramps up.";
    case "Captain":
      if (plantCount >= 2) {
        return "Captain can sometimes be used tactically to ship and deny your opponent, but it’s usually not a top priority in the early game.";
      }
      return "Captain is almost never ideal this early; shipments are limited and you usually don’t want to prematurely clear goods.";
    default:
      return "This role is usually lower priority in the opening compared to Settler, Builder, and sometimes Prospector.";
  }
}

// --- Core recommendMoves logic ---

function recommendMoves(state) {
  const { you, opponent, roundState, turnNumber } = state;
  const context = { turnNumber };

  const recommendations = [];

  // Settler choices
  if (roundState.availableRoles.includes("Settler")) {
    for (const plantation of roundState.faceUpPlantations) {
      if (plantation === "None") continue;
      const score = scorePlantationChoice(plantation, you, opponent, context);
      const title = `Take Settler → choose ${plantation}`;
      const explanation = describePlantationReason(plantation, you, opponent);
      recommendations.push({ score, title, explanation, role: "Settler", plantation });
    }
  }

  // Prospector
  if (roundState.availableRoles.includes("Prospector")) {
    const score = scoreProspector(you, context);
    const title = "Take Prospector";
    const explanation = explainProspector(you, context);
    recommendations.push({ score, title, explanation, role: "Prospector" });
  }

  // Builder – with specific building options
  if (roundState.availableRoles.includes("Builder")) {
    const builderOptions = getBuilderOptions(you, context);
    if (builderOptions.length === 0) {
      const score = 0.4;
      const title = "Take Builder (limited options)";
      const explanation = "You don't currently have strong building options you can afford, so Builder is relatively weak compared to other roles.";
      recommendations.push({ score, title, explanation, role: "Builder" });
    } else {
      builderOptions.forEach(opt => {
        const { building, score } = opt;
        const title = `Take Builder → buy ${building.name}`;
        const explanation = explainBuilderRole(you, context);
        recommendations.push({
          score,
          title,
          explanation,
          role: "Builder",
          building: building.name
        });
      });
    }
  }

  // Other roles
  for (const role of roundState.availableRoles) {
    if (["Settler", "Prospector", "Builder"].includes(role)) continue;
    const score = scoreOtherRole(role, you, context);
    const title = `Take ${role}`;
    const explanation = explainOtherRole(role, you, context);
    recommendations.push({ score, title, explanation, role });
  }

  // Sort best to worst
  recommendations.sort((a, b) => b.score - a.score);

  return recommendations;
}

// --- UI wiring & state reading ---

function readStateFromUI() {
  const governorSelect = document.getElementById("governor-select").value;
  const yourDoubloons = Number(document.getElementById("your-doubloons").value || 0);
  const oppDoubloons = Number(document.getElementById("opp-doubloons").value || 0);
  const turnNumber = Number(document.getElementById("turn-number").value);

  const plantationSelects = Array.from(document.querySelectorAll(".plantation"));
  const faceUpPlantations = plantationSelects.map(sel => sel.value);

  const availableRoles = Array.from(document.querySelectorAll(".role"))
    .filter(cb => cb.checked)
    .map(cb => cb.value);

  const oppLastRole = document.getElementById("opp-last-role").value || null;

  // Starting plantations depend on who is Governor
  const youStart = governorSelect === "you" ? "Indigo" : "Corn";
  const oppStart = governorSelect === "you" ? "Corn" : "Indigo";

  const you = {
    startingPlantation: youStart,
    extraPlantations: sessionState.extraPlantations,
    buildings: sessionState.buildings,
    doubloons: yourDoubloons
  };

  const opponent = {
    startingPlantation: oppStart,
    extraPlantations: [],
    buildings: [],
    doubloons: oppDoubloons,
    lastRole: oppLastRole
  };

  const roundState = {
    availableRoles,
    takenRoles: oppLastRole ? [{ by: "opp", role: oppLastRole }] : [],
    faceUpPlantations
  };

  return {
    you,
    opponent,
    roundState,
    turnNumber
  };
}

function updateStateDisplays() {
  const governorSelect = document.getElementById("governor-select").value;
  const plantationsDisplay = document.getElementById("your-plantations-display");
  const buildingsDisplay = document.getElementById("your-buildings-display");

  const starting = governorSelect === "you" ? "Indigo" : "Corn";

  const extras = sessionState.extraPlantations;
  const extraText = extras.length ? extras.join(", ") : "none yet";

  plantationsDisplay.textContent = `Starting crop: ${starting}. Extra plantations: ${extraText}.`;

  const buildings = sessionState.buildings;
  buildingsDisplay.textContent = buildings.length
    ? `Buildings: ${buildings.join(", ")}.`
    : "Buildings: none yet.";
}

function renderRecommendations(recs) {
  const resultsSection = document.getElementById("results");
  const list = document.getElementById("recommendation-list");
  list.innerHTML = "";

  recs.slice(0, 5).forEach(rec => {
    const li = document.createElement("li");

    // Store role + plantation + building info as data attributes so clicking can apply state
    li.dataset.role = rec.role || "";
    li.dataset.plantation = rec.plantation || "";
    li.dataset.building = rec.building || "";

    const title = document.createElement("div");
    title.className = "recommendation-title";
    title.textContent = rec.title;

    const explanation = document.createElement("div");
    explanation.className = "recommendation-explanation";
    explanation.textContent = rec.explanation;

    li.appendChild(title);
    li.appendChild(explanation);
    list.appendChild(li);
  });

  resultsSection.classList.remove("hidden");
}

// --- DOMContentLoaded: hook up events & dynamic behavior ---

document.addEventListener("DOMContentLoaded", () => {
  const button = document.getElementById("recommend-btn");
  const governorSelect = document.getElementById("governor-select");
  const yourDoubloonsInput = document.getElementById("your-doubloons");
  const oppDoubloonsInput = document.getElementById("opp-doubloons");
  const resultsSection = document.getElementById("results");
  const list = document.getElementById("recommendation-list");
  const turnSelect = document.getElementById("turn-number");
  const oppLastRoleSelect = document.getElementById("opp-last-role");

  function syncDoubloonsToGovernor() {
    if (governorSelect.value === "you") {
      // You are Governor: Indigo + 3, Opponent: Corn + 2
      yourDoubloonsInput.value = "3";
      oppDoubloonsInput.value = "2";
    } else {
      // Opponent is Governor: they get Indigo + 3, you Corn + 2
      yourDoubloonsInput.value = "2";
      oppDoubloonsInput.value = "3";
    }

    // Reset extra plantations & buildings if you flip Governor mid-game
    sessionState.extraPlantations = [];
    sessionState.buildings = [];
    updateStateDisplays();

    // Clear previous recommendations when you flip roles
    if (!resultsSection.classList.contains("hidden")) {
      list.innerHTML = "";
      resultsSection.classList.add("hidden");
    }
  }

  function populatePickNumbers() {
    const isGovernor = governorSelect.value === "you";
    const yourPicks = isGovernor ? [1, 3, 5] : [2, 4, 6];

    // Clear existing options
    turnSelect.innerHTML = "";

    // Populate with your valid picks
    yourPicks.forEach(n => {
      const opt = document.createElement("option");
      opt.value = n;
      opt.textContent = `${n} (your pick)`;
      turnSelect.appendChild(opt);
    });
  }

  function advancePickNumber() {
    const isGovernor = governorSelect.value === "you";
    const picks = isGovernor ? [1, 3, 5] : [2, 4, 6];
    const current = Number(turnSelect.value);
    const idx = picks.indexOf(current);
    if (idx >= 0 && idx < picks.length - 1) {
      turnSelect.value = String(picks[idx + 1]);
    }
    // If already at your last pick, we silently stay there.
  }

  function removePlantationFromRow(plantation) {
    if (!plantation) return;
    const selects = Array.from(document.querySelectorAll(".plantation"));
    const match = selects.find(sel => sel.value === plantation);
    if (match) {
      match.value = "None";
    }
  }

  function applyChosenMove(role, plantation, buildingName) {
    // Update session state based on chosen move
    if (role === "Settler" && plantation) {
      sessionState.extraPlantations.push(plantation);
      removePlantationFromRow(plantation);
    }

    if (role === "Builder" && buildingName) {
      // Add building and subtract cost
      const buildingDef = BUILDINGS.find(b => b.name === buildingName);
      if (buildingDef && !sessionState.buildings.includes(buildingName)) {
        sessionState.buildings.push(buildingName);
        const currentMoney = Number(yourDoubloonsInput.value || 0);
        const newMoney = Math.max(0, currentMoney - buildingDef.cost);
        yourDoubloonsInput.value = String(newMoney);
      }
    }

    if (role === "Prospector") {
      // Gain 1 doubloon
      const currentMoney = Number(yourDoubloonsInput.value || 0);
      yourDoubloonsInput.value = String(currentMoney + 1);
    }

    updateStateDisplays();

    // Remove chosen role from available roles (uncheck it)
    if (role) {
      const roleCheckbox = document.querySelector(`.role[value="${role}"]`);
      if (roleCheckbox) {
        roleCheckbox.checked = false;
      }
    }

    // Advance to your next pick in the round (if any)
    advancePickNumber();

    // Clear previous recommendations
    list.innerHTML = "";
    resultsSection.classList.add("hidden");
  }

  function applyOpponentLastRole() {
    const role = oppLastRoleSelect.value;
    if (!role) return;

    // Uncheck that role in the available roles (it has been used by opponent)
    const roleCheckbox = document.querySelector(`.role[value="${role}"]`);
    if (roleCheckbox) {
      roleCheckbox.checked = false;
    }

    // Clear previous recommendations since the game state just changed
    if (!resultsSection.classList.contains("hidden")) {
      list.innerHTML = "";
      resultsSection.classList.add("hidden");
    }
  }

  // When you click "Recommend"
  button.addEventListener("click", () => {
    const state = readStateFromUI();
    const recs = recommendMoves(state);
    renderRecommendations(recs);
  });

  // Make recommendations clickable: tap to apply move + advance
  list.addEventListener("click", (event) => {
    const li = event.target.closest("li");
    if (!li) return;
    const role = li.dataset.role || "";
    const plantation = li.dataset.plantation || "";
    const buildingName = li.dataset.building || "";
    applyChosenMove(role, plantation, buildingName);
  });

  // When you change who is Governor, update the defaults & picks
  governorSelect.addEventListener("change", () => {
    syncDoubloonsToGovernor();
    populatePickNumbers();
  });

  // When opponent's last pick changes, update available roles
  oppLastRoleSelect.addEventListener("change", applyOpponentLastRole);

  // Initialize once on load
  syncDoubloonsToGovernor();
  populatePickNumbers();
  updateStateDisplays();
});
