// --- Scoring constants & helpers ---

// Base values reflect your comment: sugar / higher-value goods are strong;
// indigo is weaker; corn still excellent as the pure economy starter.
const PLANTATION_VALUES_BASE = {
  Corn: 3.1,
  Sugar: 2.8,
  Indigo: 1.8,
  Tobacco: 2.4,
  Coffee: 2.3
};

function hasProductionForStartingCrop(playerBoard) {
  // v0: we don't track buildings yet, so assume:
  // if we take Builder and have enough money early, we can get
  // the matching small production building. This function is
  // here as a placeholder hook for when we actually track buildings.
  return false;
}

function plantationSynergyBonus(plantation, playerBoard) {
  let bonus = 0;

  // Synergy for matching your starting crop depends on WHICH crop.
  if (plantation === playerBoard.startingPlantation) {
    if (plantation === "Corn") {
      // Corn dupe is still very strong in 2p shipping pressure.
      bonus += 0.9;
    } else if (plantation === "Indigo") {
      // Matching indigo is only a mild boost – you often prefer better goods or Builder.
      bonus += 0.2;
    } else {
      // Other crops: moderate synergy
      bonus += 0.6;
    }
  }

  const all = [playerBoard.startingPlantation, ...playerBoard.extraPlantations];
  const uniqueTypes = new Set(all);

  if (!uniqueTypes.has(plantation)) {
    // Early diversification is quite nice, especially if you're Indigo starter.
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

// --- Non-Settler roles (early 2-player heuristics) ---

function scoreProspector(you, context) {
  let score = 2.0;
  if (you.doubloons <= 2) score += 0.7;
  if (context.turnNumber <= 2) score -= 0.2; // often want a strong plantation or Builder first
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

function scoreBuilder(you, context) {
  // Core idea from your note:
  // If you can get the matching small production building for your starting crop early,
  // that's often better than just another indigo tile.
  let score = 1.5;

  // If you have 3+ doubloons early, strongly prefer Builder –
  // we treat this as "you can probably buy your key small production building".
  if (you.doubloons >= 3 && context.turnNumber <= 3) {
    score += 2.0;
  } else if (you.doubloons >= 3) {
    score += 1.2;
  }

  return score;
}

function explainBuilder(you, context) {
  const bits = [];
  bits.push("Builder can be very strong early if you can buy a small production building that matches your starting crop (e.g., Small Indigo Plant or Sugar Mill).");
  if (you.doubloons >= 3) {
    bits.push("With 3+ doubloons, you have the buying power to actually grab one of those key buildings right now.");
  } else {
    bits.push("Your current money is limited, so your building options may be constrained.");
  }
  if (context.turnNumber <= 3) {
    bits.push("Doing this early sets up production and shipping before your opponent fully spins up.");
  }
  return bits.join(" ");
}

function scoreOtherRole(role, context) {
  // Round-1 2-player: non-Settler, non-Builder roles are usually lower priority.
  switch (role) {
    case "Mayor":
      return 0.6;
    case "Craftsman":
      return 0.4;
    case "Trader":
      return 0.3;
    case "Captain":
      return 0.2;
    default:
      return 0;
  }
}

function explainOtherRole(role) {
  switch (role) {
    case "Mayor":
      return "Mayor can help place colonists, but very early you usually have few buildings or plantations to staff, so it’s rarely the best opening pick.";
    case "Craftsman":
      return "Craftsman is rarely strong in the very first round before a larger production engine is online.";
    case "Trader":
      return "Trader tends to be low-impact in the opening when there are few goods to sell.";
    case "Captain":
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
      recommendations.push({ score, title, explanation });
    }
  }

  // Prospector
  if (roundState.availableRoles.includes("Prospector")) {
    const score = scoreProspector(you, context);
    const title = "Take Prospector";
    const explanation = explainProspector(you, context);
    recommendations.push({ score, title, explanation });
  }

  // Builder
  if (roundState.availableRoles.includes("Builder")) {
    const score = scoreBuilder(you, context);
    const title = "Take Builder";
    const explanation = explainBuilder(you, context);
    recommendations.push({ score, title, explanation });
  }

  // Other roles
  for (const role of roundState.availableRoles) {
    if (["Settler", "Prospector", "Builder"].includes(role)) continue;
    const score = scoreOtherRole(role, context);
    const title = `Take ${role}`;
    const explanation = explainOtherRole(role);
    recommendations.push({ score, title, explanation });
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
    extraPlantations: [], // later we can remember what you’ve already taken
    buildings: [],
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

function renderRecommendations(recs) {
  const resultsSection = document.getElementById("results");
  const list = document.getElementById("recommendation-list");
  list.innerHTML = "";

  recs.slice(0, 5).forEach(rec => {
    const li = document.createElement("li");

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

document.addEventListener("DOMContentLoaded", () => {
  const button = document.getElementById("recommend-btn");
  const governorSelect = document.getElementById("governor-select");
  const yourDoubloonsInput = document.getElementById("your-doubloons");
  const oppDoubloonsInput = document.getElementById("opp-doubloons");
  const resultsSection = document.getElementById("results");
  const list = document.getElementById("recommendation-list");

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

    // Clear previous recommendations when you flip roles
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

  // When you change who is Governor, update the default money
  governorSelect.addEventListener("change", syncDoubloonsToGovernor);

  // Initialize once on load to match the default selector value
  syncDoubloonsToGovernor();
});

