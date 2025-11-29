// --- Types & helpers (conceptual, using plain JS objects) ---

const PLANTATION_VALUES_BASE = {
  Corn: 3.0,
  Indigo: 2.6,
  Sugar: 2.2,
  Tobacco: 1.8,
  Coffee: 1.7
};

function plantationSynergyBonus(plantation, playerBoard) {
  // Simple early-game rule:
  // - Matching your starting plantation is usually good (faster shipping / production).
  // - Having at least 2 different types is also nice, but less important early.
  let bonus = 0;

  if (plantation === playerBoard.startingPlantation) {
    bonus += 0.8; // push toward strong specialization early
  }

  const all = [playerBoard.startingPlantation, ...playerBoard.extraPlantations];
  const uniqueTypes = new Set(all);
  if (!uniqueTypes.has(plantation)) {
    bonus += 0.4; // reward diversification a bit
  }

  return bonus;
}

function plantationDenyBonus(plantation, opponentBoard) {
  // If opponent starts with the same type, denying that type is mildly valuable.
  let bonus = 0;
  if (plantation === opponentBoard.startingPlantation) {
    bonus += 0.4;
  }
  return bonus;
}

function scorePlantationChoice(plantation, you, opponent, context) {
  const base = PLANTATION_VALUES_BASE[plantation] || 0;

  const synergy = plantationSynergyBonus(plantation, you);
  const deny = plantationDenyBonus(plantation, opponent);

  // Slight bump if it's your very first pick of the game:
  const turnBonus = context.turnNumber === 1 ? 0.5 : 0;

  return base + synergy + deny + turnBonus;
}

function describePlantationReason(plantation, you, opponent) {
  const parts = [];

  // Base reasoning
  if (plantation === "Corn") {
    parts.push("Corn is very strong early because it produces without a building.");
  } else if (plantation === "Indigo") {
    parts.push("Indigo is solid early and sets up for early production buildings.");
  } else {
    parts.push(`${plantation} is a higher-value export that can pay off once buildings are online.`);
  }

  if (plantation === you.startingPlantation) {
    parts.push("It matches your starting plantation, reinforcing your main production line.");
  } else {
    parts.push("It diversifies your plantation mix, giving you more flexibility later.");
  }

  if (plantation === opponent.startingPlantation) {
    parts.push("It also denies the opponent another copy of their starting crop.");
  }

  return parts.join(" ");
}

// Score non-Settler roles in a simple, round-1 context:
function scoreProspector(you, context) {
  // Early game: extra money is almost always good, especially before strong Builder turns.
  let score = 2.0;
  if (you.doubloons <= 2) score += 0.7;
  if (context.turnNumber === 1) score -= 0.3; // usually better to grab a good plantation first
  return score;
}

function explainProspector(you, context) {
  const bits = [];
  bits.push("Taking Prospector gives you an extra doubloon, improving your early buying power.");
  if (you.doubloons <= 2) {
    bits.push("Since you have relatively little money, the extra coin is especially valuable.");
  }
  if (context.turnNumber > 1) {
    bits.push("Later in the round, the best plantations may already be taken, so money is more attractive.");
  }
  return bits.join(" ");
}

function scoreBuilder(you, context) {
  // Placeholder, we’ll refine once we model specific buildings.
  // For now assume it's decent if you have 3+ doubloons.
  let score = 1.0;
  if (you.doubloons >= 3) score += 1.0;
  if (context.turnNumber === 1) score -= 0.4; // often want a plantation first
  return score;
}

function explainBuilder(you) {
  if (you.doubloons >= 3) {
    return "Builder can be strong if you can afford a useful cheap building (e.g., Small Market, Hacienda), but this logic is still a placeholder.";
  }
  return "Builder is weaker here because your money is limited; this logic is still a placeholder.";
}

function scoreOtherRole(role) {
  // Round 1, early game: Mayor / Craftsman / Trader / Captain are usually lower priority
  // compared to Settler & Prospector, unless specific setups exist.
  switch (role) {
    case "Mayor": return 0.5;
    case "Craftsman": return 0.3;
    case "Trader": return 0.2;
    case "Captain": return 0.1;
    default: return 0;
  }
}

function explainOtherRole(role) {
  switch (role) {
    case "Mayor":
      return "Mayor can help place colonists, but with so little built yet, it's usually not a top priority on the very first round.";
    case "Craftsman":
      return "Craftsman is often weak in the very first round before strong production is online.";
    case "Trader":
      return "Trader is usually low-impact in the first round; there are few goods to sell.";
    case "Captain":
      return "Captain is rarely good this early; shipments are limited and you don't want to prematurely empty goods.";
    default:
      return "This role is usually lower priority in the opening compared to Settler and Prospector.";
  }
}

// --- Core recommendMove logic ---

function recommendMoves(state) {
  const { you, opponent, roundState, turnNumber } = state;

  const context = { turnNumber };

  const recommendations = [];

  // 1) Settler candidates (one per available plantation)
  if (roundState.availableRoles.includes("Settler")) {
    for (const plantation of roundState.faceUpPlantations) {
      if (plantation === "None") continue;
      const score = scorePlantationChoice(plantation, you, opponent, context);
      const title = `Take Settler → choose ${plantation}`;
      const explanation = describePlantationReason(plantation, you, opponent);
      recommendations.push({ score, title, explanation });
    }
  }

  // 2) Prospector
  if (roundState.availableRoles.includes("Prospector")) {
    const score = scoreProspector(you, context);
    const title = "Take Prospector";
    const explanation = explainProspector(you, context);
    recommendations.push({ score, title, explanation });
  }

  // 3) Builder (placeholder)
  if (roundState.availableRoles.includes("Builder")) {
    const score = scoreBuilder(you, context);
    const title = "Take Builder (placeholder logic)";
    const explanation = explainBuilder(you, context);
    recommendations.push({ score, title, explanation });
  }

  // 4) Other roles – simple low-weight placeholders
  for (const role of roundState.availableRoles) {
    if (["Settler", "Prospector", "Builder"].includes(role)) continue;
    const score = scoreOtherRole(role);
    const title = `Take ${role}`;
    const explanation = explainOtherRole(role);
    recommendations.push({ score, title, explanation });
  }

  // Sort by score descending
  recommendations.sort((a, b) => b.score - a.score);

  return recommendations;
}

// --- Wire up UI ---

function readStateFromUI() {
  const yourStart = document.getElementById("your-start").value;
  const oppStart = document.getElementById("opp-start").value;
  const yourDoubloons = Number(document.getElementById("your-doubloons").value || 0);
  const oppDoubloons = Number(document.getElementById("opp-doubloons").value || 0);
  const turnNumber = Number(document.getElementById("turn-number").value);

  const plantationSelects = Array.from(document.querySelectorAll(".plantation"));
  const faceUpPlantations = plantationSelects
    .map(sel => sel.value)
    .filter(v => v !== "None");

  const availableRoles = Array.from(document.querySelectorAll(".role"))
    .filter(cb => cb.checked)
    .map(cb => cb.value);

  const oppLastRole = document.getElementById("opp-last-role").value || null;

  const you = {
    startingPlantation: yourStart,
    extraPlantations: [], // v0: ignore; future: let user specify
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
  button.addEventListener("click", () => {
    const state = readStateFromUI();
    const recs = recommendMoves(state);
    renderRecommendations(recs);
  });
});
