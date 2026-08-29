const socket = io();
const app = document.querySelector('#app');
const toast = document.querySelector('#toast');
const state = { role: null, code: null, question: null, result: null, timerId: null };
const symbols = ['▲', '◆', '●', '■'];

function esc(value) { const d = document.createElement('div'); d.textContent = value ?? ''; return d.innerHTML; }
function notify(message) { toast.textContent = message; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2600); }
function render(html) { clearInterval(state.timerId); app.innerHTML = html; }
function panel(content, wide = false) { return `<section class="panel ${wide ? 'wide' : ''}">${content}</section>`; }

function home() {
  state.role = null;
  render(panel(`<h1>מי מכיר את המשפחה הכי טוב?</h1><p>חידון יום הולדת חי, צבעוני ומהיר. בחרו כיצד להיכנס.</p><div class="actions"><button class="btn" id="hostBtn">🎙️ פתיחת משחק כמנחה</button><button class="btn secondary" id="playerBtn">📱 הצטרפות כשחקן</button></div>`));
  hostBtn.onclick = hostSetup; playerBtn.onclick = playerJoin;
}

function hostSetup() {
  state.role = 'host';
  render(panel(`<h2>הגדרת המשחק</h2><div class="field"><label for="count">כמה שאלות לשחק?</label><select id="count" class="select">${[2,3,4,5,6].map(n => `<option value="${n}">${n} שאלות</option>`).join('')}</select></div><div class="actions"><button class="btn" id="createBtn">יצירת משחק</button><button class="btn secondary" id="backBtn">חזרה</button></div>`));
  backBtn.onclick = home;
  createBtn.onclick = () => socket.emit('host:create', { questionCount: count.value }, response => {
    if (!response.ok) return notify('לא ניתן ליצור משחק');
    state.code = response.code; hostLobby([]);
  });
}

function hostLobby(players) {
  render(panel(`<p>השחקנים נכנסים דרך הכתובת הזו ובוחרים ״הצטרפות״</p><h2>קוד המשחק</h2><div class="code">${state.code}</div><div id="players" class="players">${playerChips(players)}</div><p id="playerCount">${players.length ? `${players.length} שחקנים מחכים` : 'ממתינים לשחקנים…'}</p><button class="btn green" id="startBtn" ${players.length ? '' : 'disabled'}>🚀 מתחילים!</button>`));
  startBtn.onclick = () => socket.emit('host:start', { code: state.code }, r => { if (!r.ok) notify(r.error || 'שגיאה'); });
}
function playerChips(players) { return players.map(p => `<span class="chip">${esc(p.name)}</span>`).join(''); }

function playerJoin() {
  state.role = 'player';
  render(panel(`<h2>מצטרפים למשחק</h2><form id="joinForm"><div class="field"><label for="gameCode">קוד בן 6 ספרות</label><input id="gameCode" class="input" inputmode="numeric" maxlength="6" required autocomplete="one-time-code"></div><div class="field"><label for="playerName">השם שלך</label><input id="playerName" class="input" maxlength="24" required autocomplete="nickname"></div><button class="btn" type="submit">כניסה למשחק</button></form><div class="actions"><button class="btn secondary" id="backBtn">חזרה</button></div>`));
  backBtn.onclick = home;
  joinForm.onsubmit = event => {
    event.preventDefault();
    socket.emit('player:join', { code: gameCode.value, name: playerName.value }, response => {
      if (!response.ok) return notify(response.error);
      state.code = response.code;
      render(panel(`<div class="feedback-icon">🙌</div><h2>נכנסת למשחק!</h2><p>מחכים שהמנחה יתחיל…</p><span class="chip">${esc(response.player.name)}</span>`));
    });
  };
}

function questionScreen(payload) {
  state.question = payload.question;
  const q = payload.question;
  const media = q.mediaUrl ? `<img class="media" src="${esc(q.mediaUrl)}" alt="מדיה לשאלה">` : '';
  const answers = q.type === 'text-input'
    ? `<form id="answerForm"><div class="field"><label for="textAnswer">התשובה שלך</label><input id="textAnswer" class="input" maxlength="80" required autofocus autocomplete="off"></div><button class="btn" type="submit">שליחת תשובה</button></form>`
    : `<div class="answer-grid ${q.type === 'boolean' ? 'boolean-grid' : ''}">${q.options.map((o, i) => `<button class="answer" data-answer="${i}"><span class="shape">${symbols[i]}</span>${esc(o)}</button>`).join('')}</div>`;
  render(panel(`<div class="meta"><span class="pill">שאלה ${payload.questionNumber} מתוך ${payload.totalQuestions}</span><div class="timer"><span id="seconds">${q.timeLimit}</span></div>${state.role === 'host' ? '<span class="pill" id="answerCount">0 ענו</span>' : '<span></span>'}</div>${media}<h2>${esc(q.question)}</h2>${state.role === 'host' ? '<p>השחקנים עונים עכשיו בטלפונים…</p>' : answers}`, true));
  if (state.role === 'player') bindAnswers(q.type);
  startTimer(q.timeLimit, payload.startedAt);
}

function bindAnswers(type) {
  if (type === 'text-input') {
    answerForm.onsubmit = event => { event.preventDefault(); submitAnswer(textAnswer.value); };
  } else document.querySelectorAll('.answer').forEach(button => button.onclick = () => {
    document.querySelectorAll('.answer').forEach(b => b.disabled = true);
    button.classList.add('selected'); submitAnswer(Number(button.dataset.answer));
  });
}

function submitAnswer(answer) {
  socket.emit('player:answer', { code: state.code, answer }, response => {
    if (!response.ok) return notify(response.error);
    state.result = response;
    render(panel(`<div class="feedback-icon">✓</div><h2>התשובה נקלטה!</h2><p>מחכים לסיום הזמן ולתוצאה…</p>`));
  });
}

function startTimer(limit, startedAt) {
  const tick = () => {
    const left = Math.max(0, limit - (Date.now() - startedAt) / 1000);
    const el = document.querySelector('.timer'); const seconds = document.querySelector('#seconds');
    if (el) el.style.setProperty('--progress', `${(left / limit) * 100}%`);
    if (seconds) seconds.textContent = Math.ceil(left);
  };
  tick(); state.timerId = setInterval(tick, 100);
}

function showResults(data) {
  if (state.role === 'player') {
    const result = state.result || { correct: false, points: 0, score: 0 };
    render(panel(`<div class="feedback-icon">${result.correct ? '🎉' : '💪'}</div><h2 class="${result.correct ? 'correct' : 'wrong'}">${result.correct ? 'תשובה נכונה!' : 'לא הפעם'}</h2><h1>+${result.points}</h1><p>הניקוד הכולל שלך: ${result.score}</p><p>ממתינים לשאלה הבאה…</p>`));
    return;
  }
  const q = state.question;
  const correctText = q.type === 'text-input' ? (Array.isArray(data.correctAnswer) ? data.correctAnswer[0] : data.correctAnswer) : q.options[data.correctAnswer];
  const entries = Object.entries(data.distribution); const max = Math.max(1, ...entries.map(([,n]) => n));
  const bars = entries.length ? entries.map(([key, n]) => { const label = q.type === 'text-input' ? key : q.options[Number(key)] ?? key; return `<div class="bar-row"><b>${esc(label)}</b><div class="bar-track"><div class="bar-fill" style="width:${n/max*100}%"></div></div><span>${n}</span></div>`; }).join('') : '<p>לא נשלחו תשובות</p>';
  render(panel(`<h2>התשובה הנכונה: <span class="correct">${esc(correctText)}</span></h2><div class="bars">${bars}</div><h2>לוח מובילים</h2>${leaderboardHtml(data.leaderboard)}<button class="btn" id="nextBtn">לשאלה הבאה ←</button>`, true));
  nextBtn.onclick = () => socket.emit('host:next', { code: state.code });
}

function leaderboardHtml(list) { return `<div class="leaderboard">${list.map((p,i) => `<div class="leader-row"><b>${i+1}</b><span>${esc(p.name)}</span><strong>${p.score}</strong></div>`).join('')}</div>`; }

socket.on('lobby:update', players => { if (state.role === 'host') hostLobby(players); });
socket.on('question:start', questionScreen);
socket.on('answer:count', ({ answered, total }) => { const el = document.querySelector('#answerCount'); if (el) el.textContent = `${answered}/${total} ענו`; });
socket.on('question-results', showResults);
socket.on('game:finished', ({ leaderboard }) => render(panel(`<div class="feedback-icon">🏆</div><h1>יש לנו מנצחים!</h1>${leaderboardHtml(leaderboard)}<button class="btn" onclick="location.reload()">משחק חדש</button>`, true)));
socket.on('game:closed', () => render(panel(`<h2>המשחק נסגר</h2><p>החיבור למנחה הסתיים.</p><button class="btn" onclick="location.reload()">חזרה להתחלה</button>`)));
socket.on('disconnect', () => notify('החיבור לשרת נותק — מנסים להתחבר מחדש'));

home();
