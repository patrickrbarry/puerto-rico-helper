// --- Simple in-memory session state (persists while page is open) ---
const sessionState = {
  extraPlantations: [],       // your plantations beyond starting
  quarries: 0,                // your quarries
  buildings: [],              // your buildings
  opponent: {
    extraPlantations: [],     // opponent plantations beyond starting
    quarries: 0,
    buildings: []
  },
  // simple per-session preference tracker
  feedbackCounts: {},         // key -> count
  turnInRound: 1,             // 1–6 for the first round
  roundNumber: 1              // we’re focusing on early rounds, start at 1
};

// --- Building definitions used for AI scoring (subset, early-game focus) ---
const BUILDINGS = [
  {
    name: "Small Indigo Plant",
    type: "production",
    crop: "Indigo",
    cost: 1,
    baseValue: 3.0
  },
  {
    name: "Small Sugar Mill",
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

// --- Cost map for all base-game buildings we allow in selectors ---
const BUILDING_COSTS = {
  "Small Indigo Plant": 1,
  "Small Sugar Mill": 2,
  "Indigo Plant": 3,
  "Sugar Mill": 4,
  "Tobacco Storage": 5,
  "Coffee Roaster": 6,

  "Small Market": 1,
  "Hacienda": 2,
  "Construction Hut": 2,
  "Small Warehouse": 3,
  "Hospice": 4,
  "Office": 5,
  "Large Market": 5,
  "Large Warehouse": 6,
  "University": 8,
  "Factory": 7,
  "Harbor": 8,
  "Wharf": 9,

  "Guild Hall": 10,
  "Residence": 10,
  "Fortress": 10,
  "Customs House": 10,
  "City Hall": 10,

  // treat "Other" and unknowns as costless for now
  "Other": 0
};

// --- Move preference helpers ---

function moveKey(role, plantation, building) {
  return `${role || ""}|${plantation || ""}|${building || ""}`;
}

function recordFeedback(role, plantation, building) {
  const key = moveKey(role, plantation, building);
  if (!key) return;
  sessionState.feedbackCounts[key] = (sessionState.feedbackCounts[key] || 0) + 1;
}

function feedbackBonus(role, plantation, building) {
  const key = moveKey(role, plantation, building);
  const count = sessionState.feedbackCounts[key] || 0;
  return 0.3 * count;
}

// --- Scoring constants & helpers ---

const PLANTATION_VALUES_BASE = {
  Corn: 3.1,
  Sugar: 2.8,
  Indigo: 1.8,
  Tobacco: 2.4,
  Coffee: 2.3
};

function plantationSynergyBonus(plantation, playerBoard) {
  let bonus = 0;

  if (plantation === playerBoard.startingPlantation) {
    if (plantation === "Corn") {
      bonus += 0.9;
    } else if (plantation === "Indigo") {
      bonus += 0.2;
    } else {
      bonus += 0.6;
    }
  }

  const all = [playerBoard.startingPlantation, ...playerBoard.extraPlantations];
  const uniqueTypes = new Set(all);

  if (!uniqueTypes.has(plantation)) {
    bonus += 0.5;
  }

  return bonus;
}

function plantationDenyBonus(plantation, opponentBoard) {
  let bonus = 0;
  if (plantation === opponentBoard.startingPlantation) {
    bonus += 0.4;
  }
  return bonus;
}

function scoreQuarryChoice(you, context) {
  let score = 2.7;
  if (context.turnNumber <= 3) score += 0.5;
  const q = you.quarries || 0;
  if (q === 0) score += 0.8;
  else if (q === 1) score += 0.3;
  else score -= 0.3 * (q - 1);
  return score;
}

function scorePlantationChoice(plantation, you, opponent, context) {
  if (plantation === "Quarry") {
    return scoreQuarryChoice(you, context);
  }

  const base = PLANTATION_VALUES_BASE[plantation] || 0;
  const synergy = plantationSynergyBonus(plantation, you);
  const deny = plantationDenyBonus(plantation, opponent);
  const earlyTurnBonus = context.turnNumber <= 2 ? 0.4 : 0;

  return base + synergy + deny + earlyTurnBonus;
}

function describePlantationReason(plantation, you, opponent) {
  const parts = [];

  if (plantation === "Quarry") {
    parts.push("Quarries reduce building costs, which is extremely valuable in 2-player where building tempo is critical.");
    const q = you.quarries || 0;
    if (q === 0) {
      parts.push("This is your first quarry, giving you a big long-term discount on buildings.");
    } else {
      parts.push("More quarries further reduce your effective building costs, though with diminishing returns.");
    }
  } else if (plantation === "Corn") {
    parts.push("Corn is extremely strong early because it produces without a building and gives fast shipping pressure in 2-player.");
  } else if (plantation === "Indigo") {
    parts.push("Indigo is weaker economically than corn; it mainly shines once you have the matching indigo production building.");
  } else if (plantation === "Sugar") {
    parts.push("Sugar is a higher-value good that scores well once the Sugar Mill is in place, making it an appealing early pick.");
  } else {
    parts.push(`${plantation} is a high-value export that pays off once the right production building is online.`);
  }

  if (plantation !== "Quarry") {
    if (plantation === you.startingPlantation) {
      parts.push("It matches your starting plantation, reinforcing that production line.");
    } else {
      parts.push("It diversifies your plantations, giving you more flexibility later.");
    }

    if (plantation === opponent.startingPlantation) {
      parts.push("It also denies the opponent another copy of their main crop.");
    }
  }

  return parts.join(" ");
}

// --- Builder logic: score specific buildings (subset) ---

function hasBuilding(buildings, name) {
  return buildings.includes(name);
}

function countPlantationType(playerBoard, type) {
  return [playerBoard.startingPlantation, ...playerBoard.extraPlantations].filter(
    p => p === type
  ).length;
}

function scoreBuildingChoice(building, you, context) {
  if (hasBuilding(you.buildings, building.name)) {
    return -999;
  }

  let score = building.baseValue;

  if (building.type === "production" && building.crop) {
    const n = countPlantationType(you, building.crop);
    if (n > 0) {
      score += 1.5 + 0.3 * (n - 1);
    } else if (building.crop === you.startingPlantation) {
      score += 1.0;
    }
  }

  if (building.name === "Small Market") {
    const uniquePlantTypes = new Set([
      you.startingPlantation,
      ...you.extraPlantations
    ]);
    if (uniquePlantTypes.size >= 2) score += 0.7;
  }

  if (building.name === "Hacienda") {
    if (context.turnNumber <= 3) score += 0.8;
  }

  const quarryDiscount = (you.quarries || 0) * 0.3;
  score += quarryDiscount;

  score -= building.cost * 0.2;

  return score;
}

function getBuilderOptions(you, context) {
  return BUILDINGS
    .filter(b => b.cost <= you.doubloons)
    .map(building => {
      const score = scoreBuildingChoice(building, you, context);
      return { building, score };
    })
    .filter(opt => opt.score > -500)
    .sort((a, b) => b.score - a.score);
}

// --- Non-Settler role heuristics ---

function scoreProspector(you, context) {
  let score = 2.0;
  if (you.doubloons <= 2) score += 0.7;
  if (context.turnNumber <= 2) score -= 0.2;
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

function scoreOtherRole(role, you, context) {
  const plantCount = [you.startingPlantation, ...you.extraPlantations].length;
  const hasAnyBuilding = you.buildings.length > 0;

  switch (role) {
    case "Mayor":
      return hasAnyBuilding || plantCount > 1 ? 1.2 : 0.6;
    case "Craftsman":
      return hasAnyBuilding ? 1.0 : 0.4;
    case "Trader":
      return 0.7;
    case "Captain":
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

  // Settler: plantations + quarry if available
  if (roundState.availableRoles.includes("Settler")) {
    for (const plantation of roundState.faceUpPlantations) {
      if (plantation === "None") continue;
      let score = scorePlantationChoice(plantation, you, opponent, context);
      score += feedbackBonus("Settler", plantation, null);

      const title = `Take Settler → choose ${plantation}`;
      const explanation = describePlantationReason(plantation, you, opponent);
      recommendations.push({ score, title, explanation, role: "Settler", plantation });
    }

    if (roundState.quarriesRemaining > 0) {
      let score = scorePlantationChoice("Quarry", you, opponent, context);
      score += feedbackBonus("Settler", "Quarry", null);

      const title = "Take Settler → choose Quarry";
      const explanation = describePlantationReason("Quarry", you, opponent);
      recommendations.push({ score, title, explanation, role: "Settler", plantation: "Quarry" });
    }
  }

  // Prospector
  if (roundState.availableRoles.includes("Prospector")) {
    let score = scoreProspector(you, context);
    score += feedbackBonus("Prospector", null, null);

    const title = "Take Prospector";
    const explanation = explainProspector(you, context);
    recommendations.push({ score, title, explanation, role: "Prospector" });
  }

  // Builder – with specific building options (subset)
  if (roundState.availableRoles.includes("Builder")) {
    const builderOptions = getBuilderOptions(you, context);
    if (builderOptions.length === 0) {
      let score = 0.4;
      score += feedbackBonus("Builder", null, null);

      const title = "Take Builder (limited options)";
      const explanation = "You don't currently have strong building options you can afford, so Builder is relatively weak compared to other roles.";
      recommendations.push({ score, title, explanation, role: "Builder" });
    } else {
      builderOptions.forEach(opt => {
        const { building } = opt;
        let score = opt.score;
        score += feedbackBonus("Builder", null, building.name);

        const title = `Take Builder → buy ${building.name}`;
        const explanation = "Builder lets you convert your doubloons into long-term engine pieces, especially strong early when paired with core production or economy buildings.";
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
    let score = scoreOtherRole(role, you, context);
    score += feedbackBonus(role, null, null);

    const title = `Take ${role}`;
    const explanation = explainOtherRole(role, you, context);
    recommendations.push({ score, title, explanation, role });
  }

  recommendations.sort((a, b) => b.score - a.score);
  return recommendations;
}

// --- UI state helpers ---

function readStateFromUI() {
  const governorSelect = document.getElementById("governor-select").value;
  const yourDoubloons = Number(document.getElementById("your-doubloons").value || 0);
  const oppDoubloons = Number(document.getElementById("opp-doubloons").value || 0);
  const turnNumber = Number(document.getElementById("turn-number").value);

  const plantationSelects = Array.from(document.querySelectorAll(".plantation"));
  const faceUpPlantations = plantationSelects.map(sel => sel.value);

  const quarriesRemaining = Number(document.getElementById("quarries-remaining").value || 0);

  const availableRoles = Array.from(document.querySelectorAll(".role"))
    .filter(cb => cb.checked)
    .map(cb => cb.value);

  const oppLastRole = document.getElementById("opp-last-role").value || null;

  const youStart = governorSelect === "you" ? "Indigo" : "Corn";
  const oppStart = governorSelect === "you" ? "Corn" : "Indigo";

  const you = {
    startingPlantation: youStart,
    extraPlantations: sessionState.extraPlantations,
    quarries: sessionState.quarries,
    buildings: sessionState.buildings,
    doubloons: yourDoubloons
  };

  const opponent = {
    startingPlantation: oppStart,
    extraPlantations: sessionState.opponent.extraPlantations,
    quarries: sessionState.opponent.quarries,
    buildings: sessionState.opponent.buildings,
    doubloons: oppDoubloons,
    lastRole: oppLastRole
  };

  const roundState = {
    availableRoles,
    takenRoles: oppLastRole ? [{ by: "opp", role: oppLastRole }] : [],
    faceUpPlantations,
    quarriesRemaining
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
  const yourPlantationsDisplay = document.getElementById("your-plantations-display");
  const yourBuildingsDisplay = document.getElementById("your-buildings-display");
  const oppPlantationsDisplay = document.getElementById("opp-plantations-display");
  const oppBuildingsDisplay = document.getElementById("opp-buildings-display");

  const yourStart = governorSelect === "you" ? "Indigo" : "Corn";
  const oppStart = governorSelect === "you" ? "Corn" : "Indigo";

  const yExtras = sessionState.extraPlantations;
  const yExtraText = yExtras.length ? yExtras.join(", ") : "none yet";
  const yQuarries = sessionState.quarries || 0;

  yourPlantationsDisplay.textContent =
    `Starting crop: ${yourStart}. Extra plantations: ${yExtraText}. Quarries: ${yQuarries}.`;

  const yBuildings = sessionState.buildings;
  yourBuildingsDisplay.textContent = yBuildings.length
    ? `Buildings: ${yBuildings.join(", ")}.`
    : "Buildings: none yet.";

  const oExtras = sessionState.opponent.extraPlantations;
  const oExtraText = oExtras.length ? oExtras.join(", ") : "none yet";
  const oQuarries = sessionState.opponent.quarries || 0;

  oppPlantationsDisplay.textContent =
    `Starting crop: ${oppStart}. Extra plantations: ${oExtraText}. Quarries: ${oQuarries}.`;

  const oBuildings = sessionState.opponent.buildings;
  oppBuildingsDisplay.textContent = oBuildings.length
    ? `Buildings: ${oBuildings.join(", ")}.`
    : "Buildings: none yet.";
}

function updateTurnDisplay() {
  const display = document.getElementById("round-turn-display");
  const summary = document.getElementById("round-summary");
  const govSelect = document.getElementById("governor-select");
  if (!display || !govSelect) return;

  const isGovernor = govSelect.value === "you";
  const yourPicks = isGovernor ? [1, 3, 5] : [2, 4, 6];
  const t = sessionState.turnInRound;
  const r = sessionState.roundNumber;

  let whose;
  if (yourPicks.includes(t)) {
    whose = "your pick";
  } else if (t >= 1 && t <= 6) {
    whose = "your opponent's pick";
  } else {
    whose = "round complete";
  }

  let text;
  if (t <= 6) {
    text = `Round ${r} – Turn ${t} of 6 – it is ${whose}.`;
  } else {
    text = `Round ${r} – Turn 6 of 6 – round complete (advance to next round manually).`;
  }

  display.textContent = text;
  if (summary) {
    summary.textContent = `Round ${r} – Turn ${Math.min(t, 6)} of 6.`;
  }
}

// Limit Settler choices for opponent/manual to actual tiles + quarry
function updateSettlerChoiceOptions() {
  const oppSelect = document.getElementById("opp-settler-gain");
  const manualSelect = document.getElementById("manual-plantation");
  const quarriesInput = document.getElementById("quarries-remaining");

  const plantationSelects = Array.from(document.querySelectorAll(".plantation"));

  const availablePlantations = new Set();
  plantationSelects.forEach(sel => {
    const v = sel.value;
    if (v && v !== "None") {
      availablePlantations.add(v);
    }
  });

  const quarriesRemaining = quarriesInput ? Number(quarriesInput.value || 0) : 0;

  // Opponent Settler gain select
  if (oppSelect) {
    const previous = oppSelect.value;
    oppSelect.innerHTML = "";

    const baseOption = document.createElement("option");
    baseOption.value = "";
    baseOption.textContent = "(n/a or unknown)";
    oppSelect.appendChild(baseOption);

    availablePlantations.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p;
      opt.textContent = `${p} plantation`;
      oppSelect.appendChild(opt);
    });

    if (quarriesRemaining > 0) {
      const opt = document.createElement("option");
      opt.value = "Quarry";
      opt.textContent = "Quarry";
      oppSelect.appendChild(opt);
    }

    if (previous && Array.from(oppSelect.options).some(o => o.value === previous)) {
      oppSelect.value = previous;
    }
  }

  // Manual Settler choice select (your move)
  if (manualSelect) {
    const previous = manualSelect.value;
    manualSelect.innerHTML = "";

    const baseOption = document.createElement("option");
    baseOption.value = "";
    baseOption.textContent = "(n/a)";
    manualSelect.appendChild(baseOption);

    availablePlantations.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p;
      opt.textContent = `${p} plantation`;
      manualSelect.appendChild(opt);
    });

    if (quarriesRemaining > 0) {
      const opt = document.createElement("option");
      opt.value = "Quarry";
      opt.textContent = "Quarry";
      manualSelect.appendChild(opt);
    }

    if (previous && Array.from(manualSelect.options).some(o => o.value === previous)) {
      manualSelect.value = previous;
    }
  }
}

function renderRecommendations(recs) {
  const resultsSection = document.getElementById("results");
  const list = document.getElementById("recommendation-list");
  list.innerHTML = "";

  recs.slice(0, 3).forEach(rec => {
    const li = document.createElement("li");
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
  const oppSettlerGainSelect = document.getElementById("opp-settler-gain");
  const oppBuilderBuildingSelect = document.getElementById("opp-builder-building");
  const quarriesRemainingInput = document.getElementById("quarries-remaining");
  const applyOppBtn = document.getElementById("apply-opp-btn");

  const manualToggleBtn = document.getElementById("manual-choice-toggle");
  const manualPanel = document.getElementById("manual-choice-panel");
  const manualRoleSelect = document.getElementById("manual-role");
  const manualPlantationSelect = document.getElementById("manual-plantation");
  const manualBuildingSelect = document.getElementById("manual-building");
  const manualReasonTextarea = document.getElementById("manual-reason");
  const manualApplyBtn = document.getElementById("manual-apply-btn");

  const plantationSelects = Array.from(document.querySelectorAll(".plantation"));

  function syncDoubloonsToGovernor() {
    if (governorSelect.value === "you") {
      yourDoubloonsInput.value = "3";
      oppDoubloonsInput.value = "2";
    } else {
      yourDoubloonsInput.value = "2";
      oppDoubloonsInput.value = "3";
    }

    // Start of a new first round perspective
    sessionState.extraPlantations = [];
    sessionState.quarries = 0;
    sessionState.buildings = [];
    sessionState.opponent.extraPlantations = [];
    sessionState.opponent.quarries = 0;
    sessionState.opponent.buildings = [];
    sessionState.feedbackCounts = {};
    sessionState.turnInRound = 1;
    sessionState.roundNumber = 1;

    // Reset quarries to full supply for a fresh board
    quarriesRemainingInput.value = "5";

    updateStateDisplays();
    updateTurnDisplay();
    updateSettlerChoiceOptions();

    if (!resultsSection.classList.contains("hidden")) {
      list.innerHTML = "";
      resultsSection.classList.add("hidden");
    }
  }

  function populatePickNumbers() {
    const isGovernor = governorSelect.value === "you";
    const yourPicks = isGovernor ? [1, 3, 5] : [2, 4, 6];

    turnSelect.innerHTML = "";
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
  }

  function removePlantationFromRow(plantation) {
    if (!plantation || plantation === "Quarry") return;
    const selects = Array.from(document.querySelectorAll(".plantation"));
    const match = selects.find(sel => sel.value === plantation);
    if (match) {
      match.value = "None";
    }
  }

  function decrementQuarriesRemaining() {
    let q = Number(quarriesRemainingInput.value || 0);
    if (q > 0) {
      q -= 1;
      quarriesRemainingInput.value = String(q);
    }
    updateSettlerChoiceOptions();
  }

  function applyChosenMove(role, plantation, buildingName) {
    if (role === "Settler" && plantation) {
      if (plantation === "Quarry") {
        sessionState.quarries += 1;
        decrementQuarriesRemaining();
      } else {
        sessionState.extraPlantations.push(plantation);
        removePlantationFromRow(plantation);
        updateSettlerChoiceOptions();
      }
    }

    if (role === "Builder" && buildingName) {
      if (!sessionState.buildings.includes(buildingName)) {
        sessionState.buildings.push(buildingName);
      }
      const cost = BUILDING_COSTS[buildingName] || 0;
      if (cost > 0) {
        const currentMoney = Number(yourDoubloonsInput.value || 0);
        const newMoney = Math.max(0, currentMoney - cost);
        yourDoubloonsInput.value = String(newMoney);
      }
    }

    if (role === "Prospector") {
      const currentMoney = Number(yourDoubloonsInput.value || 0);
      yourDoubloonsInput.value = String(currentMoney + 1);
    }

    updateStateDisplays();

    if (role) {
      const roleCheckbox = document.querySelector(`.role[value="${role}"]`);
      if (roleCheckbox) {
        roleCheckbox.checked = false;
      }
    }

    // Advance turn counter and pick number
    sessionState.turnInRound = Math.min(sessionState.turnInRound + 1, 7);
    updateTurnDisplay();
    advancePickNumber();

    list.innerHTML = "";
    resultsSection.classList.add("hidden");
  }

  function applyOpponentLastRole() {
    const role = oppLastRoleSelect.value;
    if (!role) return;

    if (role === "Settler") {
      const gain = oppSettlerGainSelect.value;
      if (gain === "Quarry") {
        sessionState.opponent.quarries += 1;
        decrementQuarriesRemaining();
      } else if (gain) {
        sessionState.opponent.extraPlantations.push(gain);
        removePlantationFromRow(gain);
        updateSettlerChoiceOptions();
      }
    }

    if (role === "Builder") {
      const buildingName = oppBuilderBuildingSelect.value;
      if (buildingName && buildingName !== "") {
        if (!sessionState.opponent.buildings.includes(buildingName)) {
          sessionState.opponent.buildings.push(buildingName);
        }
        const cost = BUILDING_COSTS[buildingName] || 0;
        if (cost > 0) {
          const currentMoney = Number(oppDoubloonsInput.value || 0);
          const newMoney = Math.max(0, currentMoney - cost);
          oppDoubloonsInput.value = String(newMoney);
        }
      }
    }

    if (role === "Prospector") {
      const currentMoney = Number(oppDoubloonsInput.value || 0);
      oppDoubloonsInput.value = String(currentMoney + 1);
    }

    updateStateDisplays();

    const roleCheckbox = document.querySelector(`.role[value="${role}"]`);
    if (roleCheckbox) {
      roleCheckbox.checked = false;
    }

    // Opponent's move advances the round turn counter too
    sessionState.turnInRound = Math.min(sessionState.turnInRound + 1, 7);
    updateTurnDisplay();

    if (!resultsSection.classList.contains("hidden")) {
      list.innerHTML = "";
      resultsSection.classList.add("hidden");
    }
  }

  button.addEventListener("click", () => {
    const state = readStateFromUI();
    const recs = recommendMoves(state);
    renderRecommendations(recs);
  });

  list.addEventListener("click", (event) => {
    const li = event.target.closest("li");
    if (!li) return;
    const role = li.dataset.role || "";
    const plantation = li.dataset.plantation || "";
    const buildingName = li.dataset.building || "";
    applyChosenMove(role, plantation, buildingName);
  });

  governorSelect.addEventListener("change", () => {
    syncDoubloonsToGovernor();
    populatePickNumbers();
  });

  applyOppBtn.addEventListener("click", applyOpponentLastRole);

  manualToggleBtn.addEventListener("click", () => {
    manualPanel.classList.toggle("hidden");
  });

  manualApplyBtn.addEventListener("click", () => {
    const role = manualRoleSelect.value;
    if (!role) {
      return;
    }

    const plantation = manualPlantationSelect.value || "";
    const buildingName = manualBuildingSelect.value || "";
    const reason = manualReasonTextarea.value.trim();

    recordFeedback(role, plantation || null, buildingName || null);

    if (reason) {
      console.log("Player explanation:", {
        role,
        plantation: plantation || null,
        building: buildingName || null,
        reason
      });
    }

    applyChosenMove(role, plantation || null, buildingName || null);

    manualPlantationSelect.value = "";
    manualBuildingSelect.value = "";
    manualReasonTextarea.value = "";
  });

  // When plantations or quarries change, refresh Settler options
  plantationSelects.forEach(sel => {
    sel.addEventListener("change", updateSettlerChoiceOptions);
  });
  quarriesRemainingInput.addEventListener("change", updateSettlerChoiceOptions);

  syncDoubloonsToGovernor();
  populatePickNumbers();
  updateStateDisplays();
  updateTurnDisplay();
  updateSettlerChoiceOptions();
});
