const { createApp } = require('./app');

const PORT = process.env.PORT || 3000;
const app = createApp();

const server = app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`App demarree sur le port ${PORT}`);
});

// Arret propre (utile dans un conteneur).
function shutdown() {
  server.close(() => process.exit(0));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = server;
