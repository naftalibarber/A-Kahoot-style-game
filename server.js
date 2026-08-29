const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const questions = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'questions.json'), 'utf8'));
const games = new Map();

app.use(express.static(path.join(__dirname, 'public')));

function makeCode() {
  let code;
  do code = String(Math.floor(100000 + Math.random() * 900000)); while (games.has(code));
  return code;
}

function normalize(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('he-IL');
}

function isCorrect(question, answer) {
  if (question.type === 'text-input') {
    const accepted = Array.isArray(question.correctAnswer) ? question.correctAnswer : [question.correctAnswer];
    return accepted.some(item => normalize(item) === normalize(answer));
  }
  return Number(answer) === Number(question.correctAnswer);
}

function publicQuestion(question) {
  const { correctAnswer, ...safe } = question;
  return safe;
}

function playerList(game) {
  return [...game.players.values()].map(({ id, name, score }) => ({ id, name, score }));
}

function leaderboard(game) {
  return playerList(game).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'he'));
}

function endQuestion(game) {
  if (!game || game.phase !== 'question') return;
  clearTimeout(game.timer);
  game.phase = 'results';
  const question = game.selected[game.current];
  const distribution = {};
  for (const answer of game.answers.values()) {
    const key = question.type === 'text-input' ? normalize(answer.answer) || 'ללא תשובה' : String(answer.answer);
    distribution[key] = (distribution[key] || 0) + 1;
  }
  io.to(game.code).emit('question-results', {
    correctAnswer: question.correctAnswer,
    distribution,
    leaderboard: leaderboard(game)
  });
}

io.on('connection', socket => {
  socket.on('host:create', ({ questionCount }, reply = () => {}) => {
    const count = Math.max(2, Math.min(6, Number(questionCount) || 2, questions.length));
    const code = makeCode();
    const selected = [...questions].sort(() => Math.random() - 0.5).slice(0, count);
    games.set(code, {
      code, hostId: socket.id, selected, current: -1, phase: 'lobby', players: new Map(), answers: new Map(), timer: null
    });
    socket.join(code);
    reply({ ok: true, code, questionCount: selected.length });
  });

  socket.on('player:join', ({ code, name }, reply = () => {}) => {
    const game = games.get(String(code || '').trim());
    const cleanName = String(name || '').trim().slice(0, 24);
    if (!game) return reply({ ok: false, error: 'קוד המשחק לא נמצא' });
    if (game.phase !== 'lobby') return reply({ ok: false, error: 'המשחק כבר התחיל' });
    if (!cleanName) return reply({ ok: false, error: 'צריך להזין שם' });
    if ([...game.players.values()].some(p => normalize(p.name) === normalize(cleanName))) {
      return reply({ ok: false, error: 'השם הזה כבר תפוס' });
    }
    game.players.set(socket.id, { id: socket.id, name: cleanName, score: 0 });
    socket.join(game.code);
    io.to(game.hostId).emit('lobby:update', playerList(game));
    reply({ ok: true, code: game.code, player: { name: cleanName, score: 0 } });
  });

  socket.on('host:start', ({ code }, reply = () => {}) => {
    const game = games.get(code);
    if (!game || game.hostId !== socket.id) return reply({ ok: false });
    if (!game.players.size) return reply({ ok: false, error: 'לפחות שחקן אחד צריך להצטרף' });
    reply({ ok: true });
    startNext(game);
  });

  socket.on('player:answer', ({ code, answer }, reply = () => {}) => {
    const game = games.get(code);
    const player = game?.players.get(socket.id);
    if (!game || !player || game.phase !== 'question' || game.answers.has(socket.id)) {
      return reply({ ok: false, error: 'לא ניתן לשלוח תשובה כעת' });
    }
    const question = game.selected[game.current];
    const elapsed = Date.now() - game.startedAt;
    const correct = isCorrect(question, answer);
    const remainingRatio = Math.max(0, 1 - elapsed / (question.timeLimit * 1000));
    const points = correct ? Math.round(500 + 500 * remainingRatio) : 0;
    player.score += points;
    game.answers.set(socket.id, { answer, correct, points });
    reply({ ok: true, correct, points, score: player.score });
    io.to(game.hostId).emit('answer:count', { answered: game.answers.size, total: game.players.size });
    if (game.answers.size === game.players.size) endQuestion(game);
  });

  socket.on('host:next', ({ code }, reply = () => {}) => {
    const game = games.get(code);
    if (!game || game.hostId !== socket.id || game.phase !== 'results') return reply({ ok: false });
    reply({ ok: true });
    if (game.current + 1 >= game.selected.length) {
      game.phase = 'finished';
      io.to(code).emit('game:finished', { leaderboard: leaderboard(game) });
    } else startNext(game);
  });

  socket.on('disconnect', () => {
    for (const [code, game] of games) {
      if (game.hostId === socket.id) {
        clearTimeout(game.timer);
        io.to(code).emit('game:closed');
        games.delete(code);
        continue;
      }
      if (game.players.delete(socket.id)) io.to(game.hostId).emit('lobby:update', playerList(game));
    }
  });
});

function startNext(game) {
  game.current += 1;
  game.phase = 'question';
  game.answers.clear();
  const question = game.selected[game.current];
  game.startedAt = Date.now();
  io.to(game.code).emit('question:start', {
    question: publicQuestion(question),
    questionNumber: game.current + 1,
    totalQuestions: game.selected.length,
    startedAt: game.startedAt
  });
  game.timer = setTimeout(() => endQuestion(game), question.timeLimit * 1000);
}

server.listen(PORT, '0.0.0.0', () => console.log(`Family Quiz running at http://localhost:${PORT}`));
