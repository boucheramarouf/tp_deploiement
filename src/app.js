const path = require('path');
const express = require('express');

/**
 * Petite logique metier isolee pour pouvoir la tester unitairement.
 */
function normalizeText(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().replace(/\s+/g, ' ');
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Stockage en memoire (suffisant pour la demo / les tests).
  const messages = [{ id: 1, text: 'Premier message' }];
  let nextId = 2;

  const startedAt = Date.now();

  // Endpoint de verification demande : GET /health
  app.get('/health', (req, res) => {
    res.status(200).json({
      status: 'ok',
      uptime: Math.round((Date.now() - startedAt) / 1000),
      timestamp: new Date().toISOString(),
    });
  });

  // Fonctionnalite metier supplementaire : liste des messages
  app.get('/api/messages', (req, res) => {
    res.status(200).json(messages);
  });

  // Fonctionnalite metier supplementaire : ajout d'un message
  app.post('/api/messages', (req, res) => {
    const text = normalizeText(req.body && req.body.text);
    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }
    const message = { id: nextId++, text };
    messages.push(message);
    return res.status(201).json(message);
  });

  return app;
}

module.exports = { createApp, normalizeText };
