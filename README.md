# Rolê — descubra seu rolê pela cidade

App web (mobile-first) com backend na **Cloudflare**:

| Parte | Serviço Cloudflare |
| --- | --- |
| Site (HTML/CSS/JS em `public/`) | Workers Static Assets |
| API (`src/index.js`) | Workers |
| Banco de dados (usuários, posts, curtidas, comentários, amigos, notificações) | D1 (SQLite) |
| Fotos dos rolês e avatares | R2 |
| Localização em tempo real (WebSocket) | Durable Objects (`src/live.js`) |
| Login com Google (grátis) | Google Identity Services (`src/google.js`) |
| Login por celular (código por SMS ou WhatsApp, pago, opcional) | Twilio Verify (`src/otp.js`) |

## Versão de demonstração (GitHub Pages)

A cada atualização da `main`, o workflow `.github/workflows/pages.yml` publica uma versão de demonstração em https://moshikgueta.github.io/Rol-/. Essa versão não usa servidor:

- **O que você posta fica só no seu navegador.** Ninguém mais vê, e nada é enviado para servidor nenhum.
- **O código de login aparece na tela**, sem SMS nem WhatsApp.
- **Os amigos "ao vivo" são simulados.**

Ela usa `public/demo.js`, que imita a API dentro do navegador. O modo demonstração liga sozinho quando o site está num endereço `github.io` (veja `public/config.js`).

Para ativar o GitHub Pages pela primeira vez: no repositório, abra **Settings → Pages** e, em **Build and deployment → Source**, escolha **GitHub Actions**. O endereço fica https://moshikgueta.github.io/Rol-/. A opção **Deploy from a branch** (`main`, pasta raiz) também funciona: o `index.html` da raiz abre o app em https://moshikgueta.github.io/Rol-/public/.

## Rodar no computador

Requer Node.js 22.12 ou mais novo.

```bash
npm install
```

```bash
cp .dev.vars.example .dev.vars
```

```bash
npm run db:migrate:local
```

```bash
npm run db:seed:local
```

```bash
npm run dev
```

Depois abra http://localhost:8787. No computador o login roda em **modo de teste**: nenhum SMS é enviado e o código aparece na tela e no terminal. O `db:seed:local` cria rolês e eventos de demonstração no Centro de Curitiba. Rode de novo para renovar os horários.

## Publicar na Cloudflare

1. Crie uma conta gratuita em https://dash.cloudflare.com e entre pelo terminal:

   ```bash
   npx wrangler login
   ```

2. Crie o banco D1. O comando mostra um `database_id`; copie e cole esse valor no lugar de `COLE_AQUI_O_ID_DO_D1` em `wrangler.jsonc`:

   ```bash
   npx wrangler d1 create role-db
   ```

3. Crie o bucket R2 para as fotos. O R2 precisa ser ativado uma vez no painel; ele tem cota gratuita.

   ```bash
   npx wrangler r2 bucket create role-media
   ```

4. Crie as tabelas no banco de produção. O seed com dados de demonstração é opcional:

   ```bash
   npm run db:migrate:remote
   ```

   ```bash
   npm run db:seed:remote
   ```

5. Configure o SMS (Twilio Verify):
   1. Crie uma conta em https://www.twilio.com.
   2. No painel, vá em **Verify → Services**, crie um serviço (por exemplo "Rolê") e copie o **Service SID** (começa com `VA`).
   3. Copie o **Account SID** (`AC...`) e o **Auth Token** da página inicial do painel.
   4. Grave os três como secrets do Worker; cada comando pede o valor:

   ```bash
   npx wrangler secret put TWILIO_ACCOUNT_SID
   ```

   ```bash
   npx wrangler secret put TWILIO_AUTH_TOKEN
   ```

   ```bash
   npx wrangler secret put TWILIO_VERIFY_SID
   ```

   Sem esses secrets, o app publicado recusa o login com a mensagem "O envio de SMS ainda não foi configurado". Ele **nunca** cai no modo de teste em produção. Na conta de teste (trial) do Twilio, o SMS só chega em números verificados no painel; para liberar qualquer número, adicione saldo à conta.

   **WhatsApp (opcional):**
   1. No Twilio, crie um remetente de WhatsApp: **Messaging → Senders → WhatsApp senders**. É preciso ligar uma conta do WhatsApp Business, e a Meta aprova o remetente.
   2. Abra o serviço do Verify, vá em **WhatsApp** e selecione esse remetente.
   3. Ative a opção no Worker. Ele pede o valor; digite `true`:

   ```bash
   npx wrangler secret put WHATSAPP_ENABLED
   ```

   O botão **Receber pelo WhatsApp** só aparece no app quando essa opção está ligada. Até lá, o app mostra só o SMS.

6. Publique:

   ```bash
   npm run deploy
   ```

   O app fica em `https://role.<sua-conta>.workers.dev`. Um domínio próprio pode ser ligado no painel, em Workers → role → Settings → Domains.

## Entrar com Google (grátis)

1. Abra https://console.cloud.google.com e crie um projeto (por exemplo "Role").
2. Em **APIs e serviços → Tela de permissão OAuth** (ou **Google Auth Platform → Branding**), preencha o nome do app ("Rolê"), o e-mail de suporte e publique como **Externo**.
3. Em **APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth**:
   - **Tipo:** Aplicativo da Web
   - **Origens JavaScript autorizadas:** `https://role.<sua-conta>.workers.dev` e, para testar no computador, `http://localhost:8787`
4. Copie o **ID do cliente** (termina em `.apps.googleusercontent.com`) e coloque em `wrangler.jsonc`, no campo `"GOOGLE_CLIENT_ID"`. Ele é público e não precisa de segredo.

O botão **Continuar com o Google** só aparece quando o Client ID está preenchido. O servidor confere a assinatura do Google em cada login. Na primeira vez, nome e foto vêm do Google e a pessoa só escolhe o @.

## Deploy automático pelo GitHub

O workflow `.github/workflows/deploy-cloudflare.yml` publica na Cloudflare a cada atualização da `main`. Para ligar, configure em **Settings → Secrets and variables → Actions → New repository secret**:

- `CLOUDFLARE_API_TOKEN`: token de API da Cloudflare (Workers Scripts, D1 e Workers R2 Storage com Edit; Account Settings com Read).
- `CLOUDFLARE_ACCOUNT_ID`: ID da sua conta, que aparece na página inicial do painel da Cloudflare, na barra lateral, em **Account ID**.

Antes do primeiro deploy, crie o banco `role-db` e o bucket `role-media`, e confira se o Database ID em `wrangler.jsonc` é o do seu banco. A cada deploy, as migrations novas do banco são aplicadas sozinhas. Para colocar ou renovar os rolês de exemplo, marque **Carregar dados de exemplo**.

## API

| Método | Rota | O que faz |
| --- | --- | --- |
| GET | `/api/auth/channels` | Formas de envio disponíveis: `{ sms, whatsapp }`. |
| POST | `/api/auth/google` | Confere o login com Google (`credential`). Conta existente: devolve `token`; conta nova: devolve `signupTicket` e sugestões de nome, @ e foto. |
| POST | `/api/auth/send` | Envia o código (`phone`, `channel`: `"sms"` ou `"whatsapp"`). |
| POST | `/api/auth/verify` | Confere o código (`phone`, `code`). Conta existente: devolve `token`; número novo: devolve `signupTicket`. |
| POST | `/api/users` | Cria a conta depois de verificar o número (`signupTicket`, `name`, `handle`). Devolve `token`. |
| DELETE | `/api/auth/session` | Sai da conta neste aparelho. |
| DELETE | `/api/auth/sessions` | Sai da conta em todos os aparelhos. |
| GET / PATCH | `/api/me` | Ver ou editar o perfil (`name`, `handle`, `avatar`). |
| GET | `/api/me/summary` | Área do membro: estatísticas, meus check-ins, rolês curtidos. |
| POST | `/api/uploads` | Envia uma foto (JPG, PNG ou WebP, até 5 MB) para o R2. |
| GET | `/api/media/*` | Serve as fotos do R2. |
| GET | `/api/geocode?lat&lng` | Endereço do ponto (OpenStreetMap/Nominatim, com cache). |
| GET / POST | `/api/posts` | Lista os rolês ativos / faz check-in. |
| GET / DELETE | `/api/posts/:id` | Ver um rolê / apagar o seu. |
| POST / DELETE | `/api/posts/:id/like` | Curtir ou descurtir. |
| GET / POST | `/api/posts/:id/comments` | Ver ou enviar comentários. |
| POST / DELETE | `/api/users/:id/follow` | Seguir (adicionar amigo) ou deixar de seguir. |
| GET | `/api/notifications` | Lista as notificações. |
| POST | `/api/notifications/read` | Marca as notificações como lidas. |
| GET (WebSocket) | `/api/live?token=` | Localização em tempo real. |

A autenticação usa `Authorization: Bearer <token>`. Cada aparelho tem a sua sessão, e no banco fica só o hash SHA-256 do token.

## Regras importantes

- **Login por celular**:
  - A pessoa digita o número e escolhe receber o código de 6 números **pelo WhatsApp** ou **por SMS**. Na tela do código dá para trocar de forma de envio. Se o número já tem conta, entra direto; se é novo, escolhe nome, @ e foto.
  - Só aceita **celular brasileiro com DDD**: `(DD) 9XXXX-XXXX`.
  - Limites contra abuso: 1 código por minuto e 5 por hora para cada número, 20 por hora para cada rede (IP). O código vale 10 minutos e é bloqueado depois de 5 tentativas erradas.

- **A localização do check-in é automática.** O app manda as coordenadas do GPS e o **endereço é calculado no servidor**, então não dá para digitar um lugar falso. O servidor também só aceita fotos enviadas pela própria pessoa.
- **Localização em tempo real**:
  - "**Amigos**" são as pessoas que você segue; só elas veem você. "**Todos**" deixa qualquer pessoa ver, inclusive quem não tem conta.
  - O compartilhamento termina no prazo escolhido, quando você toca em Parar ou quando fecha o app.
  - Visitantes sem conta só podem ver, não podem compartilhar.
- **Eventos** (aba Eventos) por enquanto são cadastrados direto no banco (veja `seed/seed.sql`). Pelo app, as pessoas postam rolês.

## Limitações conhecidas

- **Contas criadas antes do login por celular** continuam funcionando no aparelho onde foram criadas, mas não têm número ligado a elas.
- **O limite contra abuso cobre só o envio de códigos.** Posts e comentários ainda não têm limite; dá para ativar Rate Limiting no painel da Cloudflare.
- **Cada verificação do Twilio Verify tem custo**, seja por SMS ou WhatsApp (centavos de dólar por verificação).
- **Os limites de envio valem para SMS e WhatsApp juntos.** Quem pediu por WhatsApp espera 1 minuto para pedir por SMS.
- **No celular, o navegador pausa o GPS quando o app vai para segundo plano.** Para compartilhar em segundo plano de verdade, é preciso um app nativo ou PWA.
- **O link do 99** (`taxis99://call?...`) não é documentado oficialmente. Se não abrir, o app leva para a loja ou para o site da 99. O link do Uber segue a documentação oficial.
- **Um único Durable Object atende a cidade inteira.** Isso aguenta milhares de conexões; para escalar mais, dá para dividir por região.
