# Rolê — descubra seu rolê pela cidade

App web (mobile-first) com backend na **Cloudflare**:

| Parte | Serviço Cloudflare |
| --- | --- |
| Site (HTML/CSS/JS em `public/`) | Workers Static Assets |
| API (`src/index.js`) | Workers |
| Banco de dados (usuários, posts, curtidas, comentários, amigos, notificações) | D1 (SQLite) |
| Fotos dos rolês e avatares | R2 |
| Localização em tempo real (WebSocket) | Durable Objects (`src/live.js`) |

## Rodar no computador

Requer Node.js 18 ou mais novo.

```bash
npm install
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

Depois abra http://localhost:8787. O `db:seed:local` cria rolês e eventos de demonstração no Centro de Curitiba. Rode de novo para renovar os horários.

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

5. Publique:

   ```bash
   npm run deploy
   ```

   O app fica em `https://role.<sua-conta>.workers.dev`. Um domínio próprio pode ser ligado no painel, em Workers → role → Settings → Domains.

## API

| Método | Rota | O que faz |
| --- | --- | --- |
| POST | `/api/users` | Conta instantânea (`name`, `handle`). Devolve `token`. |
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

A autenticação usa `Authorization: Bearer <token>`. No banco fica só o hash SHA-256 do token.

## Regras importantes

- **A localização do check-in é automática.** O app manda as coordenadas do GPS e o **endereço é calculado no servidor**, então não dá para digitar um lugar falso. O servidor também só aceita fotos enviadas pela própria pessoa.
- **Localização em tempo real**:
  - "**Amigos**" são as pessoas que você segue; só elas veem você. "**Todos**" deixa qualquer pessoa ver, inclusive quem não tem conta.
  - O compartilhamento termina no prazo escolhido, quando você toca em Parar ou quando fecha o app.
  - Visitantes sem conta só podem ver, não podem compartilhar.
- **Eventos** (aba Eventos) por enquanto são cadastrados direto no banco (veja `seed/seed.sql`). Pelo app, as pessoas postam rolês.

## Limitações conhecidas

- **A conta não tem senha nem e-mail.** O acesso fica salvo só no aparelho; se a pessoa sair da conta ou limpar o navegador, não tem como entrar de novo. Vale adicionar login por telefone ou e-mail antes de lançar.
- **Não há limite de requisições** contra spam. Dá para ativar Rate Limiting no painel da Cloudflare ou usar o binding `ratelimit`.
- **No celular, o navegador pausa o GPS quando o app vai para segundo plano.** Para compartilhar em segundo plano de verdade, é preciso um app nativo ou PWA.
- **O link do 99** (`taxis99://call?...`) não é documentado oficialmente. Se não abrir, o app leva para a loja ou para o site da 99. O link do Uber segue a documentação oficial.
- **Um único Durable Object atende a cidade inteira.** Isso aguenta milhares de conexões; para escalar mais, dá para dividir por região.
