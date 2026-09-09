describe('Parcours E2E', () => {
  it('l\'application est disponible (GET /health)', () => {
    cy.request('/health').then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body.status).to.eq('ok');
    });
  });

  it('la page d\'accueil se charge', () => {
    cy.visit('/');
    cy.contains('h1', 'TP Deploiement');
    cy.get('#messages li').should('have.length.greaterThan', 0);
  });

  it('on peut ajouter un message via l\'interface (fonctionnalite en plus de /health)', () => {
    const text = `Message e2e ${Date.now()}`;
    cy.visit('/');
    cy.get('#new-text').type(text);
    cy.get('#add-form button[type=submit]').click();
    cy.get('#status').should('contain', 'Message ajoute');
    cy.contains('#messages li', text).should('exist');
  });

  it('l\'API messages repond en JSON', () => {
    cy.request('/api/messages').then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body).to.be.an('array');
    });
  });
});
