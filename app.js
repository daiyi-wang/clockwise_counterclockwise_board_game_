(function () {
  'use strict';

  const Core = window.BoardGameCore;
  const { SUITS, SUIT_META, BOARD_SPACES } = Core;
  const AVATARS = {
    rocket: { symbol: '🚀', label: 'Rocket' },
    star: { symbol: '★', label: 'Star' },
    lightning: { symbol: 'ϟ', label: 'Lightning' },
    planet: { symbol: '●', label: 'Planet' },
    crown: { symbol: '♛', label: 'Crown' },
    comet: { symbol: '☄', label: 'Comet' }
  };
  const EVENT_NAMES = ['lucky', 'double', 'lose', 'again', 'switch', 'challenge'];
  const MOVE_DELAY = 300;

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  let state = null;
  let recognition = null;
  let recognitionMode = 'game';
  let hintTimer = null;
  let audioContext = null;
  let selectedAvatars = { A: 'rocket', B: 'star' };

  const screens = {
    setup: $('#setup-screen'), test: $('#mic-test-screen'), game: $('#game-screen'), victory: $('#victory-screen')
  };

  function showScreen(name) {
    Object.entries(screens).forEach(([key, element]) => { element.hidden = key !== name; });
    window.scrollTo(0, 0);
  }

  function titleCase(value) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function suitMarkup(suit, count, target) {
    const meta = SUIT_META[suit];
    const complete = count >= target;
    return `<div class="suit-progress ${suit} ${complete ? 'complete' : ''}">
      <span class="suit-symbol" aria-hidden="true">${meta.symbol}</span>
      <span><small>${meta.label}</small><strong>${count} / ${target}</strong></span>
      <b aria-label="${complete ? 'complete' : 'incomplete'}">${complete ? '✓' : ''}</b>
    </div>`;
  }

  function renderAvatarOptions() {
    $$('.avatar-options').forEach((container) => {
      const team = container.dataset.team;
      container.innerHTML = Object.entries(AVATARS).map(([key, avatar]) => `
        <button class="avatar-choice ${selectedAvatars[team] === key ? 'selected' : ''}" type="button" data-avatar="${key}" aria-label="Choose ${avatar.label}" aria-pressed="${selectedAvatars[team] === key}">${avatar.symbol}</button>
      `).join('');
      container.querySelectorAll('button').forEach((button) => button.addEventListener('click', () => {
        selectedAvatars[team] = button.dataset.avatar;
        renderAvatarOptions();
      }));
    });
  }

  function boardPosition(index) {
    const angle = (index / BOARD_SPACES.length) * Math.PI * 2 - Math.PI / 2;
    return { x: 50 + Math.cos(angle) * 45, y: 50 + Math.sin(angle) * 43 };
  }

  function renderBoard() {
    const track = $('#board-track');
    track.innerHTML = BOARD_SPACES.map((space, index) => {
      const pos = boardPosition(index);
      const meta = space.suit ? SUIT_META[space.suit] : null;
      const label = space.type === 'suit' ? meta.label : space.label;
      const symbol = space.type === 'suit' ? meta.symbol : space.type === 'event' ? '?' : space.type === 'wild' ? '★' : 'GO';
      return `<div class="board-space ${space.type} ${space.suit || ''}" data-index="${index}" style="--x:${pos.x}%;--y:${pos.y}%" aria-label="Space ${index}: ${label}">
        <span class="space-number">${index}</span><strong>${symbol}</strong><small>${label}</small><div class="token-slot"></div>
      </div>`;
    }).join('');
    renderTokens();
  }

  function renderTokens() {
    $$('.board-space').forEach((space) => space.classList.remove('occupied'));
    $$('.token-slot').forEach((slot) => { slot.innerHTML = ''; });
    if (!state) return;
    ['A', 'B'].forEach((teamKey) => {
      const team = state.teams[teamKey];
      const slot = document.querySelector(`.board-space[data-index="${team.position}"] .token-slot`);
      if (!slot) return;
      const token = document.createElement('div');
      token.className = `team-token token-${teamKey.toLowerCase()}`;
      token.dataset.team = teamKey;
      token.setAttribute('aria-label', `${team.name} token`);
      token.textContent = AVATARS[team.avatar].symbol;
      slot.appendChild(token);
      slot.closest('.board-space').classList.add('occupied');
    });
    $$('.token-slot').forEach((slot) => slot.classList.toggle('shared', slot.children.length > 1));
  }

  function renderTeamPanel(teamKey) {
    const panel = $(`#team-panel-${teamKey.toLowerCase()}`);
    const team = state.teams[teamKey];
    const active = state.activeTeam === teamKey && state.phase !== 'victory';
    panel.classList.toggle('active', active);
    panel.innerHTML = `
      <div class="team-heading"><div class="panel-avatar">${AVATARS[team.avatar].symbol}</div><div><small>TEAM ${teamKey}</small><h2>${escapeHtml(team.name)}</h2></div></div>
      <div class="target-title"><span>Target card</span><small>${Object.values(team.target).reduce((a, b) => a + b, 0)} CARDS</small></div>
      <div class="suit-list">${SUITS.map((suit) => suitMarkup(suit, team.collection[suit], team.target[suit])).join('')}</div>
      <button class="exchange-button" data-exchange="${teamKey}" type="button" ${!active || state.phase !== 'ready-to-roll' || state.exchangeUsedThisTurn || !Core.canExchange(team.collection) ? 'disabled' : ''}>Exchange 5 → 1</button>
      <div class="active-ribbon">${active ? 'YOUR TURN' : 'WAITING'}</div>`;
    const exchange = panel.querySelector('.exchange-button');
    if (exchange) exchange.addEventListener('click', () => openExchange(teamKey));
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function renderStatus() {
    if (!state) return;
    renderTeamPanel('A');
    renderTeamPanel('B');
    renderTokens();
    const active = state.teams[state.activeTeam];
    $('#turn-label').textContent = `${active.name}’s turn`;
    $('#turn-dot').className = `dot-${state.activeTeam.toLowerCase()}`;
    const labels = {
      'ready-to-roll': 'ROLL THE DIE', 'waiting-for-speech': 'SAY A DIRECTION', listening: 'LISTENING',
      moving: 'MOVING', 'resolving-space': 'CARD TIME', event: 'EVENT', 'turn-complete': 'NEXT TEAM'
    };
    $('#phase-label').textContent = labels[state.phase] || state.phase.toUpperCase();
    $('#die-button').disabled = state.phase !== 'ready-to-roll';
    $('#mic-button').disabled = !['waiting-for-speech', 'event'].includes(state.phase) || state.isListening;
    $('#mic-button').classList.toggle('listening', state.isListening);
    $('#hint-button').hidden = !state.hintsEnabled || state.phase !== 'waiting-for-speech';
    $('#teacher-hints').checked = state.hintsEnabled;
    $('#teacher-sound').checked = state.soundEnabled;
    $('#sound-toggle').setAttribute('aria-pressed', String(state.soundEnabled));
    $('#sound-toggle').setAttribute('aria-label', state.soundEnabled ? 'Turn sound off' : 'Turn sound on');
    $('#sound-toggle').textContent = state.soundEnabled ? '♪' : '×';
    updateTeacherControls();
  }

  function setMessage(message, recognized = '') {
    $('#main-message').textContent = message;
    $('#recognized-text').textContent = recognized;
  }

  function setPhase(phase) {
    state.phase = phase;
    renderStatus();
  }

  function playTone(kind) {
    if (!state || !state.soundEnabled || state.isListening) return;
    try {
      audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
      const notes = { roll: 150, correct: 660, move: 360, collect: 520, event: 240, victory: 784 };
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.frequency.value = notes[kind] || 400;
      oscillator.type = kind === 'event' ? 'square' : 'sine';
      gain.gain.setValueAtTime(0.06, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.12);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.13);
    } catch (_) { /* Sound is an enhancement; gameplay continues without it. */ }
  }

  async function rollDie() {
    if (state.phase !== 'ready-to-roll') return;
    state.exchangeUsedThisTurn = state.exchangeUsedThisTurn || false;
    $('#die-button').classList.add('rolling');
    playTone('roll');
    for (let i = 0; i < 8; i += 1) {
      $('#die-face').textContent = 1 + Math.floor(Math.random() * 6);
      await sleep(55);
    }
    state.dieValue = 1 + Math.floor(Math.random() * 6);
    $('#die-face').textContent = state.dieValue;
    $('#die-button').classList.remove('rolling');
    setPhase('waiting-for-speech');
    setMessage(`Move ${state.dieValue} ${state.dieValue === 1 ? 'space' : 'spaces'}. Press the microphone and say the direction.`);
  }

  function createRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return null;
    const instance = new SpeechRecognition();
    instance.lang = 'en-US';
    instance.continuous = false;
    instance.interimResults = false;
    instance.maxAlternatives = 1;
    return instance;
  }

  function recognitionErrorMessage(error) {
    if (error === 'not-allowed' || error === 'service-not-allowed') return 'Microphone permission was denied. Allow microphone access in Chrome.';
    if (error === 'audio-capture') return 'No microphone was found. Check the microphone and try again.';
    if (error === 'no-speech') return 'I couldn’t hear you. Please try again.';
    if (error === 'network') return 'Speech recognition is temporarily unavailable.';
    return 'The microphone had a problem. Please try again.';
  }

  function beginListening(mode = 'game') {
    if (state && state.isListening) return;
    recognitionMode = mode;
    recognition = createRecognition();
    if (!recognition) {
      if (mode === 'test') {
        $('#test-status').textContent = 'Speech recognition is not supported in this browser.';
        $('#mic-help').hidden = false;
        $('#retry-test').hidden = false;
        $('#begin-game').disabled = false;
      } else {
        state.failedSpeechAttempts += 1;
        setMessage('Speech recognition is unavailable. Say the direction aloud, then ask the teacher to move you.');
        $('#retry-speech').hidden = true;
        updateTeacherControls();
      }
      return;
    }
    if (state) {
      state.isListening = true;
      if (mode === 'game') setPhase(state.challengeDirection ? 'event' : 'listening');
    }
    if (mode === 'test') {
      $('#test-mic-button').classList.add('listening');
      $('#test-mic-button').disabled = true;
      $('#test-status').textContent = 'Listening…';
      $('#test-transcript').textContent = '';
    } else {
      setMessage(state.challengeDirection ? `Say “${state.challengeDirection}.”` : 'Listening…');
      renderStatus();
    }
    recognition.onresult = (event) => handleSpeechResult(event.results[0][0].transcript, mode);
    recognition.onerror = (event) => handleSpeechError(event.error, mode);
    recognition.onend = () => {
      if (state) { state.isListening = false; renderStatus(); }
      $('#test-mic-button').classList.remove('listening');
      $('#test-mic-button').disabled = false;
    };
    try { recognition.start(); } catch (_) { handleSpeechError('aborted', mode); }
  }

  function handleSpeechResult(transcript, mode) {
    const direction = Core.detectDirection(transcript);
    if (mode === 'test') {
      $('#test-transcript').textContent = `I heard: ${transcript}`;
      if (direction === 'clockwise') {
        $('#test-status').textContent = 'Microphone ready!';
        $('#begin-game').disabled = false;
        $('#retry-test').hidden = true;
        $('#mic-help').hidden = true;
        playSetupTone();
      } else {
        $('#test-status').textContent = 'That wasn’t “clockwise.” Try again.';
        $('#retry-test').hidden = false;
      }
      return;
    }
    state.isListening = false;
    if (direction === 'invalid') {
      state.failedSpeechAttempts += 1;
      setPhase(state.challengeDirection ? 'event' : 'waiting-for-speech');
      setMessage('Please say the whole direction word.', `I heard: ${transcript}`);
      $('#retry-speech').hidden = false;
      if (state.failedSpeechAttempts >= 3) setMessage('Ask the teacher for help. Your die result is safe.', `I heard: ${transcript}`);
      return;
    }
    if (state.challengeDirection && direction !== state.challengeDirection) {
      state.failedSpeechAttempts += 1;
      setPhase('event');
      setMessage(`The challenge says ${state.challengeDirection}. Try that direction.`, `I heard: ${direction}`);
      $('#retry-speech').hidden = false;
      return;
    }
    $('#retry-speech').hidden = true;
    state.failedSpeechAttempts = 0;
    playTone('correct');
    setMessage(`I heard: ${direction}.`, 'Great speaking!');
    highlightDirection(direction);
    const steps = state.challengeDirection ? 2 : state.dieValue;
    state.challengeDirection = null;
    setTimeout(() => moveActiveTeam(direction, steps), 400);
  }

  function handleSpeechError(error, mode) {
    const message = recognitionErrorMessage(error);
    if (mode === 'test') {
      $('#test-status').textContent = message;
      $('#retry-test').hidden = false;
      $('#mic-help').hidden = false;
      $('#begin-game').disabled = false;
      return;
    }
    state.isListening = false;
    state.failedSpeechAttempts += 1;
    setPhase(state.challengeDirection ? 'event' : 'waiting-for-speech');
    setMessage(state.failedSpeechAttempts >= 3 ? 'Ask the teacher for help. Your die result is safe.' : message);
    $('#retry-speech').hidden = false;
  }

  function highlightDirection(direction) {
    const arrow = direction === 'clockwise' ? $('#cw-arrow') : $('#ccw-arrow');
    arrow.classList.add('chosen');
    setTimeout(() => arrow.classList.remove('chosen'), 1300);
  }

  async function moveActiveTeam(direction, steps) {
    if (!steps || !['clockwise', 'counterclockwise'].includes(direction)) return;
    state.pendingDirection = direction;
    setPhase('moving');
    const team = state.teams[state.activeTeam];
    const path = Core.movementPath(team.position, steps, direction);
    for (const position of path) {
      team.position = position;
      renderTokens();
      playTone('move');
      await sleep(window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 40 : MOVE_DELAY);
    }
    state.pendingDirection = null;
    if (state.challengeDirection === null && state.dieValue === null) {
      await finishTurn();
      return;
    }
    await resolveLandingSpace();
  }

  async function resolveLandingSpace() {
    setPhase('resolving-space');
    const team = state.teams[state.activeTeam];
    const space = BOARD_SPACES[team.position];
    if (space.type === 'suit') {
      team.collection[space.suit] += 1;
      state.lastSuitCollected = space.suit;
      playTone('collect');
      setMessage(`${team.name} gets one ${space.suit}!`);
      renderStatus();
      await sleep(800);
      if (checkForVictory()) return;
      await finishTurn();
    } else if (space.type === 'event') {
      await triggerRandomEvent();
    } else if (space.type === 'wild') {
      setPhase('event');
      setMessage('Wild card! Choose one suit.');
      await chooseWildSuit();
    } else {
      setMessage('Back to START.');
      await sleep(700);
      await finishTurn();
    }
  }

  async function triggerRandomEvent(forcedEvent) {
    setPhase('event');
    playTone('event');
    const event = forcedEvent || EVENT_NAMES[Math.floor(Math.random() * EVENT_NAMES.length)];
    const team = state.teams[state.activeTeam];
    let revealTitle = '';
    let revealCopy = '';
    let continueLabel = 'Got it — continue';
    if (event === 'lucky') {
      const suit = Core.randomSuit();
      team.collection[suit] += 1;
      state.lastSuitCollected = suit;
      setMessage(`Lucky card! Get one ${suit}.`);
      revealTitle = 'Lucky card!';
      revealCopy = `${team.name} gets one ${suit}.`;
    } else if (event === 'double') {
      // An event space is not a suit space, so the Version 1 rule awards a random suit.
      const suit = Core.randomSuit();
      team.collection[suit] += 1;
      state.lastSuitCollected = suit;
      setMessage(`Double reward! Get one more ${suit}.`);
      revealTitle = 'Double reward!';
      revealCopy = `${team.name} gets one more card: ${suit}.`;
    } else if (event === 'lose') {
      const owned = SUITS.filter((suit) => team.collection[suit] > 0);
      if (owned.length) {
        const suit = owned[Math.floor(Math.random() * owned.length)];
        team.collection[suit] -= 1;
        setMessage(`Oh no! Lose one ${suit}.`);
        revealCopy = `${team.name} loses one ${suit}.`;
      } else {
        setMessage('Oh no! No cards to lose.');
        revealCopy = `${team.name} has no cards to lose.`;
      }
      revealTitle = 'Oh no! Lose one.';
    } else if (event === 'again') {
      state.extraTurn = true;
      setMessage('Roll again! The same team takes another turn.');
      revealTitle = 'Roll again!';
      revealCopy = `${team.name} gets another complete turn.`;
      continueLabel = 'Roll again';
    } else if (event === 'switch') {
      const oldA = state.teams.A.position;
      state.teams.A.position = state.teams.B.position;
      state.teams.B.position = oldA;
      renderTokens();
      setMessage('Switch places! The team tokens traded spaces.');
      revealTitle = 'Switch places!';
      revealCopy = 'Team A and Team B exchange board positions.';
    } else if (event === 'challenge') {
      state.challengeDirection = Math.random() < 0.5 ? 'clockwise' : 'counterclockwise';
      state.dieValue = null;
      setMessage(`Direction challenge! Say “${state.challengeDirection}” to move 2 spaces.`);
      revealTitle = 'Direction challenge!';
      revealCopy = `Say “${state.challengeDirection}” to move 2 spaces.`;
      continueLabel = 'Start challenge';
      renderStatus();
      await showEventReveal(event, revealTitle, revealCopy, continueLabel);
      return;
    }
    renderStatus();
    await showEventReveal(event, revealTitle, revealCopy, continueLabel);
    if (checkForVictory()) return;
    await finishTurn();
  }

  function showEventReveal(event, title, copy, buttonLabel) {
    return new Promise((resolve) => {
      const dialog = $('#choice-dialog');
      dialog.classList.add('event-reveal');
      dialog.dataset.event = event;
      $('#dialog-title').textContent = title;
      $('#dialog-copy').textContent = copy;
      $('#dialog-options').innerHTML = '';
      $('#dialog-actions').innerHTML = '';
      const badge = document.createElement('div');
      badge.className = 'event-card-badge';
      badge.textContent = 'EVENT CARD';
      $('#dialog-options').appendChild(badge);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'dialog-option event-continue';
      button.textContent = buttonLabel;
      button.addEventListener('click', () => {
        closeDialog();
        resolve();
      });
      $('#dialog-actions').appendChild(button);
      dialog.showModal();
      button.focus();
    });
  }

  function chooseWildSuit() {
    return new Promise((resolve) => {
      openDialog('Wild card!', 'Choose one suit to collect.', SUITS.map((suit) => ({
        label: `${SUIT_META[suit].symbol} ${SUIT_META[suit].label}`, className: suit,
        action: async () => {
          closeDialog();
          const team = state.teams[state.activeTeam];
          team.collection[suit] += 1;
          state.lastSuitCollected = suit;
          setMessage(`${team.name} chose one ${suit}.`);
          renderStatus();
          if (!checkForVictory()) await finishTurn();
          resolve();
        }
      })));
    });
  }

  async function finishTurn() {
    if (state.phase === 'victory') return;
    setPhase('turn-complete');
    await sleep(450);
    if (!state.extraTurn) state.activeTeam = state.activeTeam === 'A' ? 'B' : 'A';
    state.extraTurn = false;
    state.dieValue = null;
    state.pendingDirection = null;
    state.challengeDirection = null;
    state.exchangeUsedThisTurn = false;
    state.failedSpeechAttempts = 0;
    $('#die-face').textContent = '?';
    $('#retry-speech').hidden = true;
    setPhase('ready-to-roll');
    setMessage(`${state.teams[state.activeTeam].name}, roll the die.`);
  }

  function openExchange(teamKey) {
    if (state.activeTeam !== teamKey || state.phase !== 'ready-to-roll' || state.exchangeUsedThisTurn) return;
    const team = state.teams[teamKey];
    const eligible = SUITS.filter((suit) => team.collection[suit] >= 5);
    const chooseSource = () => openDialog('Choose 5 cards to give', 'Only suits with at least 5 cards are available.', eligible.map((fromSuit) => ({
      label: `${SUIT_META[fromSuit].symbol} 5 ${SUIT_META[fromSuit].label}s`, className: fromSuit,
      action: () => chooseTarget(fromSuit)
    })), true);
    const chooseTarget = (fromSuit) => openDialog('Choose 1 card to receive', `You are giving 5 ${fromSuit}s.`, SUITS.filter((suit) => suit !== fromSuit).map((toSuit) => ({
      label: `${SUIT_META[toSuit].symbol} 1 ${SUIT_META[toSuit].label}`, className: toSuit,
      action: () => confirmExchange(fromSuit, toSuit)
    })), true);
    const confirmExchange = (fromSuit, toSuit) => openDialog('Confirm exchange', `Exchange 5 ${fromSuit}s for 1 ${toSuit}?`, [{
      label: 'Confirm', className: 'confirm', action: () => {
        Core.performExchange(team.collection, fromSuit, toSuit);
        state.exchangeUsedThisTurn = true;
        closeDialog();
        setMessage(`Exchanged 5 ${fromSuit}s for 1 ${toSuit}.`);
        renderStatus();
        checkForVictory();
      }
    }], true);
    chooseSource();
  }

  function openDialog(title, copy, options, cancelable = false) {
    $('#choice-dialog').classList.remove('event-reveal');
    delete $('#choice-dialog').dataset.event;
    $('#dialog-title').textContent = title;
    $('#dialog-copy').textContent = copy;
    $('#dialog-options').innerHTML = '';
    $('#dialog-actions').innerHTML = '';
    options.forEach((option) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `dialog-option ${option.className || ''}`;
      button.textContent = option.label;
      button.addEventListener('click', option.action);
      $('#dialog-options').appendChild(button);
    });
    if (cancelable) {
      const cancel = document.createElement('button');
      cancel.type = 'button'; cancel.className = 'text-button'; cancel.textContent = 'Cancel';
      cancel.addEventListener('click', closeDialog); $('#dialog-actions').appendChild(cancel);
    }
    $('#choice-dialog').showModal();
  }

  function closeDialog() {
    const dialog = $('#choice-dialog');
    if (dialog.open) dialog.close();
    dialog.classList.remove('event-reveal');
    delete dialog.dataset.event;
  }

  function checkForVictory() {
    const team = state.teams[state.activeTeam];
    if (!Core.checkVictory(team)) return false;
    state.phase = 'victory';
    renderStatus();
    showVictory(state.activeTeam);
    return true;
  }

  function showVictory(teamKey) {
    const team = state.teams[teamKey];
    showScreen('victory');
    $('#winner-avatar').textContent = AVATARS[team.avatar].symbol;
    $('#winner-title').textContent = `${team.name} wins!`;
    $('#winner-summary').innerHTML = SUITS.map((suit) => suitMarkup(suit, team.collection[suit], team.target[suit])).join('');
    $('#confetti').innerHTML = Array.from({ length: 30 }, (_, index) => `<i style="--i:${index};--x:${Math.random() * 100}%;--d:${Math.random() * 1.5}s">${SUIT_META[SUITS[index % 4]].symbol}</i>`).join('');
    playTone('victory');
  }

  function startConfiguredGame() {
    const config = {
      teamAName: $('#team-a-name').value.trim() || 'Team A', teamBName: $('#team-b-name').value.trim() || 'Team B',
      teamAAvatar: selectedAvatars.A, teamBAvatar: selectedAvatars.B,
      targetTotal: Number($('#difficulty').value), hintsEnabled: $('#hints-setting').checked,
      soundEnabled: $('#sound-setting').checked
    };
    state = Core.createGameState(config);
    $('#teacher-hints').checked = state.hintsEnabled;
    $('#teacher-sound').checked = state.soundEnabled;
    showScreen('game');
    renderBoard();
    renderStatus();
    setMessage(`${state.teams.A.name}, roll the die.`);
  }

  function updateTeacherControls() {
    if (!state) return;
    const mayMove = ['waiting-for-speech', 'listening', 'event'].includes(state.phase) && (Boolean(state.dieValue) || Boolean(state.challengeDirection));
    $('#manual-cw').disabled = !mayMove;
    $('#manual-ccw').disabled = !mayMove;
    $('#teacher-retry').disabled = !mayMove;
    $('#end-turn').disabled = ['moving', 'resolving-space', 'victory'].includes(state.phase);
  }

  function teacherMove(direction) {
    if (!state || $('#manual-cw').disabled) return;
    if (state.isListening && recognition) recognition.abort();
    if (state.challengeDirection && direction !== state.challengeDirection) {
      setMessage(`The challenge requires ${state.challengeDirection}.`);
      return;
    }
    const steps = state.challengeDirection ? 2 : state.dieValue;
    state.challengeDirection = null;
    $('#retry-speech').hidden = true;
    closeTeacherPanel();
    moveActiveTeam(direction, steps);
  }

  function toggleTeacherPanel(show) {
    const panel = $('#teacher-panel');
    const shouldShow = show === undefined ? panel.hidden : show;
    panel.hidden = !shouldShow;
    $('#scrim').hidden = !shouldShow;
    $('#teacher-toggle').setAttribute('aria-expanded', String(shouldShow));
    if (shouldShow) $('#teacher-close').focus();
  }

  function closeTeacherPanel() { toggleTeacherPanel(false); }

  function showHint() {
    clearTimeout(hintTimer);
    $('#hint-words').hidden = false;
    hintTimer = setTimeout(() => { $('#hint-words').hidden = true; }, 3000);
  }

  function syncSound(enabled) {
    if (state) { state.soundEnabled = enabled; renderStatus(); }
    $('#sound-setting').checked = enabled;
    $('#teacher-sound').checked = enabled;
  }

  function playSetupTone() {
    try {
      const tempState = state;
      if (!state) state = { soundEnabled: $('#sound-setting').checked, isListening: false };
      playTone('correct');
      state = tempState;
    } catch (_) { /* optional sound */ }
  }

  function bindEvents() {
    $('#setup-form').addEventListener('submit', (event) => {
      event.preventDefault();
      showScreen('test');
      const supported = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
      if (!supported) {
        $('#test-status').textContent = 'Speech recognition is not supported in this browser.';
        $('#mic-help').hidden = false;
        $('#begin-game').disabled = false;
      }
    });
    $('#test-mic-button').addEventListener('click', () => beginListening('test'));
    $('#retry-test').addEventListener('click', () => beginListening('test'));
    $('#skip-test').addEventListener('click', startConfiguredGame);
    $('#begin-game').addEventListener('click', startConfiguredGame);
    $('#die-button').addEventListener('click', rollDie);
    $('#mic-button').addEventListener('click', () => beginListening('game'));
    $('#retry-speech').addEventListener('click', () => beginListening('game'));
    $('#hint-button').addEventListener('click', showHint);
    $('#teacher-toggle').addEventListener('click', () => toggleTeacherPanel());
    $('#teacher-close').addEventListener('click', closeTeacherPanel);
    $('#scrim').addEventListener('click', closeTeacherPanel);
    $('#manual-cw').addEventListener('click', () => teacherMove('clockwise'));
    $('#manual-ccw').addEventListener('click', () => teacherMove('counterclockwise'));
    $('#teacher-retry').addEventListener('click', () => { closeTeacherPanel(); beginListening('game'); });
    $('#end-turn').addEventListener('click', async () => { closeTeacherPanel(); await finishTurn(); });
    $('#teacher-hints').addEventListener('change', (event) => {
      if (state) { state.hintsEnabled = event.target.checked; renderStatus(); }
      $('#hints-setting').checked = event.target.checked;
    });
    $('#teacher-sound').addEventListener('change', (event) => syncSound(event.target.checked));
    $('#sound-toggle').addEventListener('click', () => syncSound(state ? !state.soundEnabled : !$('#sound-setting').checked));
    $('#restart-game').addEventListener('click', () => {
      if (window.confirm('Restart this game? Current progress will be lost.')) { closeTeacherPanel(); startConfiguredGame(); }
    });
    $('#play-again').addEventListener('click', startConfiguredGame);
    $('#new-setup').addEventListener('click', () => { state = null; showScreen('setup'); });
    $('#choice-dialog').addEventListener('cancel', (event) => event.preventDefault());
  }

  function init() {
    renderAvatarOptions();
    bindEvents();
    renderBoard();
  }

  window.__gameApp = {
    getState: () => state,
    setState: (nextState) => { state = nextState; renderStatus(); renderTokens(); },
    detectDirection: Core.detectDirection,
    moveActiveTeam, triggerRandomEvent, checkForVictory, startConfiguredGame
  };

  init();
})();
