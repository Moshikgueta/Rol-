# Rolê — descubra seu rolê pela cidade

App web (mobile-first) com backend na **Cloudflare**:

| Parte | Serviço Cloudflare |
| --- | --- |
| Site (HTML/CSS/JS em `public/`) | Workers Static Assets |
| API (`src/index.js`) | Workers |
| Banco de dados (usuários, posts, curtidas, comentários, amigos, notificações) | D1 (SQLite) |
| Fotos dos rolês e avatares | R2 |
| Localização em tempo real (WebSocket) | Durable Objects (`src/live.js`) |
| Login por celular (código por SMS) | Twilio Verify (`src/otp.js`) |

## Rodar no computador

Requer Node.js 18 ou mais novo.

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

6. Publique:

   ```bash
   npm run deploy
   ```

   O app fica em `https://role.<sua-conta>.workers.dev`. Um domínio próprio pode ser ligado no painel, em Workers → role → Settings → Domains.

## API

| Método | Rota | O que faz |
| --- | --- | --- |
| POST | `/api/auth/send` | Envia o código por SMS (`phone`). |
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
  - A pessoa digita o número e recebe um código de 6 números por SMS. Se o número já tem conta, entra direto; se é novo, escolhe nome, @ e foto.
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
- **Cada SMS do Twilio Verify custa** (no Brasil, centavos de dólar por verificação). O Verify também aceita envio por **WhatsApp**; para usar, crie um remetente de WhatsApp no Twilio e troque `Channel: "sms"` por `"whatsapp"` em `src/otp.js`.
- **No celular, o navegador pausa o GPS quando o app vai para segundo plano.** Para compartilhar em segundo plano de verdade, é preciso um app nativo ou PWA.
- **O link do 99** (`taxis99://call?...`) não é documentado oficialmente. Se não abrir, o app leva para a loja ou para o site da 99. O link do Uber segue a documentação oficial.
- **Um único Durable Object atende a cidade inteira.** Isso aguenta milhares de conexões; para escalar mais, dá para dividir por região.
