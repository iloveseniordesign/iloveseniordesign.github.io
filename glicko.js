// glicko.js
// Real Glicko-2 implementation (simplified for single match updates)
// https://www.glicko.net/glicko/glicko2.pdf

const GLICKO2_SCALE = 173.7178; // 400 / ln(10)
const TAU = 0.5;                 // system constant, typical 0.3–1.2

// Convert rating/RD to Glicko-2 scale
function toGlicko2Scale(rating, rd) {
    const mu = (rating - 1500) / GLICKO2_SCALE;
    const phi = rd / GLICKO2_SCALE;
    return { mu, phi };
}

// Convert back to normal rating scale
function fromGlicko2Scale(mu, phi) {
    const rating = mu * GLICKO2_SCALE + 1500;
    const rd = phi * GLICKO2_SCALE;
    return { rating, rd };
}

// g(phi) factor
function g(phi) {
    return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

// Expected score
function E(mu, mu_j, phi_j) {
    return 1 / (1 + Math.exp(-g(phi_j) * (mu - mu_j)));
}

// Calculate d^2
function calculateD2(phi, results) {
    let sum = 0;
    results.forEach(r => {
        const Eij = E(r.mu_j, r.mu, r.phi_j);
        const gphi = g(r.phi_j);
        sum += gphi * gphi * Eij * (1 - Eij);
    });
    return 1 / sum;
}

// Volatility update (simplified iterative method)
function updateVolatility(phi, sigma, delta, v) {
    const a = Math.log(sigma * sigma);
    const EPSILON = 0.000001;

    let A = a;
    let B;
    if (delta * delta > phi * phi + v) {
        B = Math.log(delta * delta - phi * phi - v);
    } else {
        let k = 1;
        while (f(a - k * TAU, delta, phi, v, a) < 0) k++;
        B = a - k * TAU;
    }

    let fA = f(A, delta, phi, v, a);
    let fB = f(B, delta, phi, v, a);

    while (Math.abs(B - A) > EPSILON) {
        const C = A + (A - B) * fA / (fB - fA);
        const fC = f(C, delta, phi, v, a);
        if (fC * fB < 0) {
            A = B;
            fA = fB;
        } else {
            fA = fA / 2;
        }
        B = C;
        fB = fC;
    }

    return Math.exp(A / 2);
}

function f(x, delta, phi, v, a) {
    const ex = Math.exp(x);
    return ex * (delta * delta - phi * phi - v - ex) / (2 * (phi * phi + v + ex) * (phi * phi + v + ex)) - (x - a) / (TAU * TAU);
}

// Update rating for a single match
// results: [{ opponentRating, opponentRD, score }]
export function updateGlicko2Rating(player, results) {
    if (results.length === 0) return player;

    // Convert to Glicko-2 scale
    let { mu, phi } = toGlicko2Scale(player.rating, player.rd);
    let sigma = player.volatility;

    // Prepare opponent data
    const opps = results.map(r => {
        const { mu: mu_j, phi: phi_j } = toGlicko2Scale(r.opponentRating, r.opponentRD);
        return { mu_j, phi_j, score: r.score, mu };
    });

    // Step 1: compute v
    let v_inv = 0;
    opps.forEach(r => {
        const Eij = E(mu, r.mu_j, r.phi_j);
        const gphi = g(r.phi_j);
        v_inv += gphi * gphi * Eij * (1 - Eij);
    });
    const v = 1 / v_inv;

    // Step 2: compute delta
    let delta = 0;
    opps.forEach(r => {
        const Eij = E(mu, r.mu_j, r.phi_j);
        const gphi = g(r.phi_j);
        delta += gphi * (r.score - Eij);
    });
    delta *= v;

    // Step 3: update volatility
    const sigma_prime = updateVolatility(phi, sigma, delta, v);

    // Step 4: update phi*
    const phi_star = Math.sqrt(phi * phi + sigma_prime * sigma_prime);

    // Step 5: update phi and mu
    let phi_prime = 1 / Math.sqrt(1 / (phi_star * phi_star) + 1 / v);

    let sum = 0;
    opps.forEach(r => {
        const Eij = E(mu, r.mu_j, r.phi_j);
        const gphi = g(r.phi_j);
        sum += gphi * (r.score - Eij);
    });
    const mu_prime = mu + phi_prime * phi_prime * sum;

    // Convert back to rating scale
    const { rating, rd } = fromGlicko2Scale(mu_prime, phi_prime);

    return {
        ...player,
        rating: Math.round(rating),
        rd: rd,
        volatility: sigma_prime
    };
}

// RD time decay (50 → 100 in 10 days)
export function applyRDDecay(player, lastMatchDate) {
    if (!lastMatchDate) return { ...player, rd: 350 };
    const now = new Date();
    const last = new Date(lastMatchDate);
    const days = (now - last) / (1000 * 60 * 60 * 24);
    const RD_min = 50;
    const RD_max = 100;
    const newRD = Math.min(RD_max, RD_min + (RD_max - RD_min) * (days / 10));
    return { ...player, rd: newRD };
}