const request = require('supertest');
const { createApp, normalizeText } = require('../src/app');

describe('normalizeText', () => {
  test('supprime les espaces superflus', () => {
    expect(normalizeText('  bonjour   le   monde ')).toBe('bonjour le monde');
  });

  test('retourne une chaine vide pour une valeur non string', () => {
    expect(normalizeText(null)).toBe('');
    expect(normalizeText(42)).toBe('');
  });
});

describe('API', () => {
  let app;
  beforeEach(() => {
    app = createApp();
  });

  test('GET /health renvoie 200 et status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.timestamp).toBe('string');
  });

  test('GET /api/messages renvoie un tableau', async () => {
    const res = await request(app).get('/api/messages');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('POST /api/messages ajoute un message', async () => {
    const res = await request(app)
      .post('/api/messages')
      .send({ text: 'Hello CI' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ text: 'Hello CI' });

    const list = await request(app).get('/api/messages');
    expect(list.body.some((m) => m.text === 'Hello CI')).toBe(true);
  });

  test('POST /api/messages refuse un texte vide', async () => {
    const res = await request(app).post('/api/messages').send({ text: '   ' });
    expect(res.status).toBe(400);
  });
});
