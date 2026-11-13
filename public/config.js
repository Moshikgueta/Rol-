// Configuração do app. No GitHub Pages (github.io) não há servidor, então o app
// roda em modo demonstração. No Worker da Cloudflare ele usa a API de verdade.
window.ROLE_CONFIG = { demo: /\.github\.io$/.test(location.hostname) };
