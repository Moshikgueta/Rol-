# Rolê — descubra seu rolê pela cidade

Protótipo web (mobile-first) do app **Rolê**. É HTML, CSS e JavaScript puro, sem etapa de build.

## Como rodar

```bash
python3 -m http.server 8080
```

Depois abra `http://localhost:8080` no navegador. No computador, use o modo celular do DevTools. A geolocalização só funciona em `localhost` ou em HTTPS.

## Telas e funcionalidades

- **Boas-vindas**: logo ROLÊ, "descubra seu rolê pela cidade", botões **Descubra** e **Criar Nova Conta**.
- **Criar conta instantânea**: foto, nome e @usuário. Não pede e-mail nem senha.
- **Mapa** (Centro de Curitiba):
  - pins redondos com borda amarela mostram a foto de quem postou;
  - abas **Rolês** (status de pessoas) e **Eventos** (pins quadrados);
  - busca por rolê, lugar ou @pessoa;
  - notificações;
  - botões **Lista** (ordenada por distância) e **+ Check-in**.
- **Post do rolê** (card sobre o mapa):
  - @ e foto de quem postou no canto superior esquerdo, horário do post e foto do evento;
  - selo GRÁTIS/PAGO, título, descrição e nota de 1 a 5 estrelas dada por quem postou;
  - localização automática, contagem do tempo restante do status;
  - curtir, comentar, compartilhar e **Ir até o rolê**.
- **Ir até o rolê**: abre o **Uber** com o destino já preenchido, o **99** ou a rota no Google Maps.
- **Check-in**: foto, nome do rolê, descrição, avaliação, grátis/pago e tempo de exibição (1h, 3h ou 6h). A **localização vem do GPS e não pode ser editada**. O endereço é obtido pelo OpenStreetMap/Nominatim.
- **Localização em tempo real**:
  - escolha quem vê (Amigos ou Todos) e por quanto tempo (15 min, 1h, 8h ou até desligar);
  - sua posição se atualiza no mapa enquanto você se move;
  - um banner "Ao vivo" mostra o tempo restante, com botões para ajustar ou parar;
  - opção de enviar um link para alguém;
  - amigos que estão compartilhando aparecem com o selo AO VIVO.
- **Área do membro**: perfil com estatísticas, interruptor da localização em tempo real, meus check-ins (com opção de apagar), rolês que curti, editar perfil e sair da conta.
- **Menu lateral**: atalhos para todas as áreas acima.

## Limitações do protótipo

- **Sem servidor**: conta, check-ins, curtidas e comentários ficam salvos só no aparelho (`localStorage`). As outras pessoas e eventos do mapa são dados de demonstração (`data.js`).
- **Localização em tempo real**: por enquanto ela só aparece no seu próprio mapa. Para outras pessoas verem de verdade, é preciso um backend com WebSocket ou Firebase. O "enviar link" manda a posição atual, não um link que acompanha você ao vivo.
- **99**: o link `taxis99://call?...` não está documentado oficialmente. Se o app não abrir, o protótipo leva para a loja de aplicativos ou para o site da 99. O link do Uber (`m.uber.com/ul`) segue a documentação oficial.
- **Fotos de demonstração** vêm de picsum.photos e pravatar.cc. **Mapa**: OpenStreetMap + CARTO.
