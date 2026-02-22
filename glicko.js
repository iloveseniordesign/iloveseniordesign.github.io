// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyCHRQOLzC0DcuZv4aCqsL4EM_IVthiZSIc",
    authDomain: "tttiw-6d44e.firebaseapp.com",
    projectId: "tttiw-6d44e",
    storageBucket: "tttiw-6d44e.firebasestorage.app",
    messagingSenderId: "902138155809",
    appId: "1:902138155809:web:0860c66b77d07746952460"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

let players = [];
let actionLog = [];
const TAU = 0.5;

// DOM
const leaderboardBody = document.getElementById('leaderboard-body');
const addPlayerForm = document.getElementById('add-player-form');
const logMatchForm = document.getElementById('log-match-form');
const winnerSelect = document.getElementById('winner-select');
const loserSelect = document.getElementById('loser-select');
const actionLogContainer = document.getElementById('action-log-container');
const playersListContainer = document.getElementById('players-list');

// ----- RD Functions -----
function calculateRD(lastMatch) {
    if (!lastMatch) return 350;
    const now = new Date();
    const last = new Date(lastMatch);
    const days = (now - last)/(1000*60*60*24);
    return Math.min(350, 50 + (days/10)*50);
}

function glicko2Update(player, results) {
    // player: {rating, rd, volatility}
    if (results.length === 0) return player;

    const PI = Math.PI;
    const phi = player.rd / 173.717;
    let v = 0, delta = 0;
    results.forEach(r => {
        const g = 1 / Math.sqrt(1 + 3 * r.opponentRD*r.opponentRD/(PI*PI*400*400));
        const E = 1 / (1 + Math.pow(10, -g*(player.rating - r.opponentRating)/400));
        v += g*g*E*(1-E);
        delta += g*(r.outcome - E);
    });
    v = 1/v;
    delta = v*delta;

    const newPhi = 1 / Math.sqrt(1/(phi*phi) + 1/v);
    const newRating = player.rating + 400*(delta / newPhi);
    return {
        ...player,
        rating: Math.round(newRating),
        rd: Math.max(50, newPhi*173.717),
        volatility: player.volatility
    };
}

// ----- UI & Firebase -----
async function init() {
    try {
        const playerSnap = await db.collection('players').get();
        players = playerSnap.docs.map(d => d.data());
        const logSnap = await db.collection('actionLog').orderBy('timestamp','asc').get();
        actionLog = logSnap.docs.map(d => ({...d.data(), id:d.id}));
        updatePlayerRDs();
        updateUI();
    } catch(e){console.error(e);}
}

function updatePlayerRDs() {
    players.forEach(p => p.rd = calculateRD(p.lastMatchDate));
}

addPlayerForm.addEventListener('submit', async e=>{
    e.preventDefault();
    const name = document.getElementById('player-name').value.trim();
    const elo = parseInt(document.getElementById('initial-elo').value);
    if(!name) return alert("Enter name");
    const newPlayer = {
        id: Date.now().toString(),
        name,
        rating: elo,
        rd: 350,
        volatility: 2.0,
        wins:0,
        losses:0,
        lastMatchDate: new Date().toISOString()
    };
    players.push(newPlayer);
    await saveData();
    updateUI();
    addPlayerForm.reset();
});

logMatchForm.addEventListener('submit', async e=>{
    e.preventDefault();
    const winnerId = winnerSelect.value, loserId = loserSelect.value;
    if(winnerId===loserId) return alert("Cannot play yourself");
    const winner = players.find(p=>p.id===winnerId);
    const loser = players.find(p=>p.id===loserId);
    if(!winner||!loser) return;

    const winnerResults = [{opponentRating: loser.rating, opponentRD: loser.rd, outcome:1}];
    const loserResults = [{opponentRating: winner.rating, opponentRD: winner.rd, outcome:0}];

    const oldW = winner.rating, oldL = loser.rating;
    Object.assign(winner, glicko2Update(winner, winnerResults));
    winner.wins++; winner.lastMatchDate = new Date().toISOString();
    Object.assign(loser, glicko2Update(loser, loserResults));
    loser.losses++; loser.lastMatchDate = new Date().toISOString();

    actionLog.push({
        id: Date.now().toString(),
        type:'match_result',
        winner:winner.name,
        loser:loser.name,
        winnerId,
        loserId,
        oldWinnerElo: oldW,
        oldLoserElo: oldL,
        newWinnerElo: winner.rating,
        newLoserElo: loser.rating,
        timestamp: new Date().toISOString()
    });

    await saveData(); updatePlayerRDs(); updateUI(); logMatchForm.reset();
});

async function saveData(){
    players.forEach(p=>db.collection('players').doc(p.id).set(p));
    actionLog.forEach(a=>db.collection('actionLog').doc(a.id.toString()).set(a));
}

function updateUI(){
    players.sort((a,b)=>b.rating-a.rating);
    leaderboardBody.innerHTML='';
    const visible = players.filter(p=>p.rd<100);
    visible.forEach((p,i)=>{
        const tr=document.createElement('tr');
        tr.innerHTML=`<td class="${i===0?'rank-1':''}">${i===0?'👑 1':i+1}</td>
        <td class="${i===0?'rank-1':''}">${p.name}</td>
        <td class="${i===0?'rank-1':''}">${p.rating} (±${p.rd.toFixed(1)})</td>
        <td>${p.wins}-${p.losses}</td>`;
        leaderboardBody.appendChild(tr);
    });

    winnerSelect.innerHTML='<option value="">Select Winner...</option>';
    loserSelect.innerHTML='<option value="">Select Loser...</option>';
    players.forEach(p=>{
        winnerSelect.innerHTML+=`<option value="${p.id}">${p.name}</option>`;
        loserSelect.innerHTML+=`<option value="${p.id}">${p.name}</option>`;
    });

    if(players.length===0) playersListContainer.innerHTML='<p style="color:#888;text-align:center;">No players yet</p>';
    else {
        playersListContainer.innerHTML='';
        players.forEach(p=>{
            const div=document.createElement('div'); div.className='match-row';
            div.innerHTML=`<span>${p.name} | ${p.rating} (±${p.rd.toFixed(1)})</span>
            <div class="action-buttons">
            <button class="btn-small btn-delete" onclick="deletePlayer('${p.id}')">Delete</button></div>`;
            playersListContainer.appendChild(div);
        });
    }

    if(actionLog.length===0) actionLogContainer.innerHTML='<p style="color:#888;text-align:center;">No actions recorded yet</p>';
    else {
        actionLogContainer.innerHTML='';
        actionLog.forEach(a=>{
            const div=document.createElement('div'); div.className='match-row';
            div.textContent=`${a.timestamp.split('T')[0]}: ${a.winner} (${a.oldWinnerElo}→${a.newWinnerElo}) beat ${a.loser} (${a.oldLoserElo}→${a.newLoserElo})`;
            actionLogContainer.appendChild(div);
        });
    }
}

window.deletePlayer = async function(id){
    players=players.filter(p=>p.id!==id);
    await db.collection('players').doc(id).delete();
    updateUI();
};
