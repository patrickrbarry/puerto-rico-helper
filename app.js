// --- Scoring constants & helpers ---

const PLANTATION_VALUES_BASE = {
  Corn: 3.0,
  Indigo: 2.6,
  Sugar: 2.2,
  Tobacco: 1.8,
  Coffee: 1.7
};

function plantationSynergyBonus(plantation, playerBoard) {
  let bonus = 0;

  if (plantation === playerBoard.startingPlantation) {
    // Matching your starting crop is usually strong in 2p
    bonus += 0.8;
  }

  const all = [playerBoard.startingPlantation, ...playerBoard.extraPlantations];
  const uniqueTypes = new Set(all);
  if (!uniqueTypes.has(plantation)) {
    // A bit of credit for diversification
    bonus += 0.4;
  }

  return bonus;
}

function plantationDenyBonus(plantation, opponentBoard) {
  let bonus = 0;
  if (plantation === opponentBoard.startingPlantation) {
    // Deny the opponent another copy of their main crop
    bonus += 0.4;
  }
  return bonus;
}

function scorePlantationChoice(plantation, you, opponent, context) {
  const base = PLANTATION_VALUES_BASE[plantation] || 0;
  const synergy = plantationSynergyBonus(plantation, you);
  const deny = plantationDenyBonus(plantation, opponent);

  // Earlier picks in the round matter more for shaping your engine.
  const earlyTurnBonus = context.turnNumber <= 2 ? 0.5 : 0;

  return base + synergy + deny + earlyTurnBonus;
}

function describePlantationReason(plantation, you, opponent) {
  const parts = [];

  if (plantation === "Corn") {
    parts.push("Corn is extremely strong early because it produces without a building and gives fast shipping pressure in 2-player.");
  } else if (plantation === "Indigo") {
    parts.push("Indigo is solid early and sets up for cheap early production buildings.");
  } else {
    parts.push(`${plantation} is a higher-value export that pays off once production buildings are online.`);
  }

  if (plantation === you.startingPlantation) {
    parts.push("It matches your starting plantation, reinforcing your main production line.");
  } else {
    parts.push("It diversifies your plantations, giving you more flexibility later.");
  }

  if (plantation === opponent.startingPlantation) {
    parts.push("It also denies the opponent another copy of their starting crop.");
  }

  return parts.join(" ");
}

// --- Non-Settler roles (early 2-player heuristics) ---

function scoreProspector(you, context) {
  let score = 2.0;
  if (you.doubloons <= 2) score += 0.7;
  if (context.turnNumber <= 2) score -= 0.2; // often want early plantations first
  return score;
}

function explainProspector(you, context) {
  const bits = [];
  bits.push("Prospector gives you an extra doubloon, improving early buying power for key buildings.");
  if (you.doubloons <= 2) {
    bits.push("Because your money is low, the extra coin is especially attractive.");
  }
  if (context.turnNumber >= 3) {
    bits.push("Later in the round, the best plantations may already be taken, making money relatively better.");
  }
  return bits.join(" ");
}

function scoreBuilder(you, context) {
  // Simple placeholder: builder is decent if you have 3+ doubloons,
  // and a bit better later in the round when plantations are mostly chosen.
  let score = 1.2;
  if (you.doubloons >= 3) score += 0.8;
  if (context.turnNumber >= 3) score += 0.4;
  return score;
}

function explainBuilder(you, context) {
  const bits = [];
  bits.push("Builder can be strong if you can afford an impactful early building (e.g., Small Market, Hacienda).");
  if (you.doubloons < 3) {
    bits.push("Right now your money is limited, so your building options may be constrained.");
  }
  if (context.turnNumber >= 3) {
    bits.push("Later in the round, locking in a building before the next production/shipping cycle can be valuable.");
  }
  return bits.join(" ");
}

function scoreOtherRole(role, context) {
  // Round-1 2-player: non-Settler roles are usually lower priority.
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
      return "Mayor can help place colonists, but very early you usually have few buildings or plantations to staff.";
    case "Craftsman":
      return "Craftsman is rarely strong in the very first round before a bigger production engine is online.";
    case "Trader":
      return "Trader tends to be low-impact in the opening when there are few goods to sell.";
    case "Captain":
      return "Captain is almost never ideal this early; shipments are limited and you don’t want to prematurely clear goods.";
    default:
      return "This role is usually lower priority in the opening compared to Settler and Prospector.";
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

// --- UI wiring ---

function readStateFromUI() {
  // Official 2-player: starting plantations are fixed
  const yourDoubloons = Number(document.getElementById("your-doubloons").value || 0);
  const oppDoubloons = Number(document.getElementById("opp-doubloons").value || 0);
  const turnNumber = Number(document.getElementById("turn-number").value);

  const plantationSelects = Array.from(document.querySelectorAll(".plantation"));
  const faceUpPlantations = plantationSelects.map(sel => sel.value);

  const availableRoles = Array.from(document.querySelectorAll(".role"))
    .filter(cb => cb.checked)
    .map(cb => cb.value);

  const oppLastRole = document.getElementById("opp-last-role").value || null;

  const you = {
    startingPlantation: "Indigo",
    extraPlantations: [], // later we can track what you’ve already taken
    buildings: [],
    doubloons: yourDoubloons
  };

  const opponent = {
    startingPlantation: "Corn",
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
  button.addEventListener("click", () => {
    const state = readStateFromUI();
    const recs = recommendMoves(state);
    renderRecommendations(recs);
  });
});
