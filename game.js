(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BoardGameCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  'use strict';

  const SUITS = ['spade', 'heart', 'diamond', 'club'];
  const SUIT_META = {
    spade: { symbol: '♠', label: 'Spade' },
    heart: { symbol: '♥', label: 'Heart' },
    diamond: { symbol: '♦', label: 'Diamond' },
    club: { symbol: '♣', label: 'Club' }
  };

  const BOARD_SPACES = [
    { type: 'start', label: 'START' },
    { type: 'suit', suit: 'heart' },
    { type: 'event', label: 'EVENT' },
    { type: 'suit', suit: 'spade' },
    { type: 'suit', suit: 'diamond' },
    { type: 'event', label: 'EVENT' },
    { type: 'suit', suit: 'club' },
    { type: 'suit', suit: 'heart' },
    { type: 'event', label: 'EVENT' },
    { type: 'suit', suit: 'diamond' },
    { type: 'suit', suit: 'spade' },
    { type: 'event', label: 'EVENT' },
    { type: 'wild', label: 'WILD' },
    { type: 'suit', suit: 'club' },
    { type: 'suit', suit: 'heart' },
    { type: 'event', label: 'EVENT' },
    { type: 'suit', suit: 'spade' },
    { type: 'suit', suit: 'diamond' },
    { type: 'suit', suit: 'club' },
    { type: 'event', label: 'EVENT' },
    { type: 'suit', suit: 'heart' },
    { type: 'suit', suit: 'spade' },
    { type: 'suit', suit: 'club' },
    { type: 'suit', suit: 'diamond' }
  ];

  function emptyCollection() {
    return { spade: 0, heart: 0, diamond: 0, club: 0 };
  }

  function normalizeTranscript(transcript) {
    return String(transcript || '')
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function detectDirection(transcript) {
    const text = normalizeTranscript(transcript);
    if (text.includes('counterclockwise') || text.includes('counter clockwise') ||
        text.includes('anticlockwise') || text.includes('anti clockwise')) {
      return 'counterclockwise';
    }
    if (text.includes('clockwise')) return 'clockwise';
    return 'invalid';
  }

  function selectDirectionCandidate(alternatives) {
    const candidates = Array.from(alternatives || []).map((candidate) => ({
      transcript: typeof candidate === 'string' ? candidate : String(candidate?.transcript || ''),
      confidence: typeof candidate === 'object' && Number.isFinite(candidate?.confidence) ? candidate.confidence : null
    })).filter((candidate) => candidate.transcript.trim());
    const topTranscript = candidates[0]?.transcript || '';
    const valid = candidates.find((candidate) => detectDirection(candidate.transcript) !== 'invalid');
    return {
      direction: valid ? detectDirection(valid.transcript) : 'invalid',
      transcript: valid?.transcript || topTranscript,
      topTranscript,
      confidence: valid?.confidence ?? null
    };
  }

  function containsCjk(text) {
    return /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/u.test(String(text || ''));
  }

  function calculatePosition(position, steps, direction, boardLength = BOARD_SPACES.length) {
    if (direction === 'clockwise') return (position + steps) % boardLength;
    if (direction === 'counterclockwise') return (position - steps % boardLength + boardLength) % boardLength;
    throw new Error('Invalid direction');
  }

  function movementPath(position, steps, direction, boardLength = BOARD_SPACES.length) {
    const path = [];
    let current = position;
    for (let i = 0; i < steps; i += 1) {
      current = calculatePosition(current, 1, direction, boardLength);
      path.push(current);
    }
    return path;
  }

  function generateTargetCard(total = 8, random = Math.random) {
    if (total < 4 || total > 12) throw new Error('Target total must be between 4 and 12');
    const target = { spade: 1, heart: 1, diamond: 1, club: 1 };
    let remaining = total - 4;
    while (remaining > 0) {
      const eligible = SUITS.filter((suit) => target[suit] < 3);
      const suit = eligible[Math.floor(random() * eligible.length)];
      target[suit] += 1;
      remaining -= 1;
    }
    return target;
  }

  function canExchange(collection) {
    return SUITS.some((suit) => collection[suit] >= 5);
  }

  function performExchange(collection, fromSuit, toSuit) {
    if (!SUITS.includes(fromSuit) || !SUITS.includes(toSuit)) throw new Error('Unknown suit');
    if (fromSuit === toSuit) throw new Error('Choose a different suit');
    if (collection[fromSuit] < 5) throw new Error('Not enough cards');
    collection[fromSuit] -= 5;
    collection[toSuit] += 1;
    return collection;
  }

  function checkVictory(team) {
    return SUITS.every((suit) => team.collection[suit] >= team.target[suit]);
  }

  function randomSuit(random = Math.random) {
    return SUITS[Math.floor(random() * SUITS.length)];
  }

  function createGameState(config = {}, random = Math.random) {
    const total = Number(config.targetTotal) || 8;
    return {
      phase: 'ready-to-roll',
      activeTeam: 'A',
      dieValue: null,
      pendingDirection: null,
      isListening: false,
      isMoving: false,
      directionCommitted: false,
      extraTurn: false,
      exchangeUsedThisTurn: false,
      failedSpeechAttempts: 0,
      hintsEnabled: Boolean(config.hintsEnabled),
      soundEnabled: config.soundEnabled !== false,
      challengeDirection: null,
      lastSuitCollected: null,
      teams: {
        A: {
          name: config.teamAName || 'Team A', avatar: config.teamAAvatar || 'rocket', position: 0,
          target: generateTargetCard(total, random), collection: emptyCollection()
        },
        B: {
          name: config.teamBName || 'Team B', avatar: config.teamBAvatar || 'star', position: 0,
          target: generateTargetCard(total, random), collection: emptyCollection()
        }
      }
    };
  }

  return {
    SUITS, SUIT_META, BOARD_SPACES, emptyCollection, normalizeTranscript, detectDirection,
    selectDirectionCandidate, containsCjk, calculatePosition, movementPath, generateTargetCard, canExchange, performExchange,
    checkVictory, randomSuit, createGameState
  };
});
