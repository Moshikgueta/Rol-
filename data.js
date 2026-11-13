// Dados de demonstração (Centro de Curitiba). Em produção, viriam de uma API.
window.ROLE_DATA = (() => {
  const now = Date.now();
  const min = 60 * 1000;
  const photo = (seed) => `https://picsum.photos/seed/${seed}/720/960`;
  const face = (n) => `https://i.pravatar.cc/200?img=${n}`;

  const people = {
    petala: { name: "Pétala", handle: "petala", avatar: face(47) },
    caio: { name: "Caio Martins", handle: "caiom", avatar: face(12) },
    ju: { name: "Juliana Reis", handle: "ju.reis", avatar: face(45) },
    beto: { name: "Beto Araújo", handle: "betoaraujo", avatar: face(53) },
    nina: { name: "Nina Souza", handle: "ninasz", avatar: face(32) },
    rafa: { name: "Rafa Lima", handle: "rafalima", avatar: face(68) },
  };

  // type: "role" = status de uma pessoa | "event" = evento divulgado
  const posts = [
    {
      id: "p1", type: "role", author: people.petala,
      title: "Pretinhosidade saindo na Tiradentes",
      description: "Bloco afro já na concentração, bateria tá pesada! Chega mais 🥁",
      photo: photo("bateria"), lat: -25.4286, lng: -49.2706,
      place: "Pça. Tiradentes - Centro, Curitiba",
      rating: 5, free: true, postedAt: now - 38 * min, durationMin: 210,
      likes: 42, comments: [
        { author: people.caio, text: "Tô indo!!", at: now - 20 * min },
        { author: people.ju, text: "Que energia 🔥", at: now - 12 * min },
      ],
    },
    {
      id: "p2", type: "role", author: people.caio,
      title: "Roda de samba no Largo",
      description: "Samba de raiz e cerveja gelada, ainda tem mesa.",
      photo: photo("samba"), lat: -25.4278, lng: -49.2738,
      place: "Largo da Ordem - São Francisco, Curitiba",
      rating: 4, free: true, postedAt: now - 75 * min, durationMin: 240,
      likes: 18, comments: [],
    },
    {
      id: "p3", type: "role", author: people.ju,
      title: "Happy hour no Teatro Guaíra",
      description: "Saída da peça, galera reunida na frente.",
      photo: photo("teatro"), lat: -25.4320, lng: -49.2660,
      place: "R. XV de Novembro - Centro, Curitiba",
      rating: 3, free: false, postedAt: now - 15 * min, durationMin: 120,
      likes: 7, comments: [],
    },
    {
      id: "p4", type: "role", author: people.beto,
      title: "Rap na Treze de Maio",
      description: "Batalha de rima começando agora!",
      photo: photo("rap"), lat: -25.4262, lng: -49.2686,
      place: "R. Treze de Maio - São Francisco, Curitiba",
      rating: 5, free: true, postedAt: now - 52 * min, durationMin: 180,
      likes: 31, comments: [{ author: people.nina, text: "Melhor batalha da cidade", at: now - 30 * min }],
    },
    {
      id: "p5", type: "role", author: people.nina,
      title: "Sunset no Passeio Público",
      description: "Piquenique tranquilo, traz sua canga.",
      photo: photo("piquenique"), lat: -25.4250, lng: -49.2660,
      place: "Passeio Público - Centro, Curitiba",
      rating: 4, free: true, postedAt: now - 95 * min, durationMin: 180,
      likes: 12, comments: [],
    },
    {
      id: "e1", type: "event", author: { name: "Teatro Novelas Curitibanas", handle: "novelascuritibanas", avatar: photo("palco") },
      title: "Peça: Noites de Curitiba",
      description: "Sessão às 21h. Ingressos na bilheteria.",
      photo: photo("palco"), lat: -25.4269, lng: -49.2716,
      place: "Teatro Novelas Curitibanas - São Francisco",
      rating: 5, free: false, postedAt: now - 180 * min, durationMin: 420,
      likes: 54, comments: [],
    },
    {
      id: "e2", type: "event", author: { name: "Museu Paranaense", handle: "museupr", avatar: photo("museu") },
      title: "Noite no Museu",
      description: "Visita guiada noturna com DJ no pátio.",
      photo: photo("museu"), lat: -25.4282, lng: -49.2680,
      place: "Museu Paranaense - São Francisco",
      rating: 4, free: true, postedAt: now - 240 * min, durationMin: 480,
      likes: 88, comments: [],
    },
    {
      id: "e3", type: "event", author: { name: "Feirinha do Largo", handle: "feiradolargo", avatar: photo("feira") },
      title: "Feira de Artesanato",
      description: "Comida de rua, artesanato e música ao vivo.",
      photo: photo("feira"), lat: -25.4295, lng: -49.2745,
      place: "Largo da Ordem - São Francisco",
      rating: 4, free: true, postedAt: now - 120 * min, durationMin: 360,
      likes: 23, comments: [],
    },
  ];

  // Amigos compartilhando localização em tempo real (posições se movem na demo)
  const liveFriends = [
    { person: people.rafa, lat: -25.4305, lng: -49.2700 },
    { person: people.ju, lat: -25.4318, lng: -49.2668 },
  ];

  const notifications = [
    { text: "@caiom curtiu seu check-in", at: now - 8 * min },
    { text: "@rafalima está compartilhando a localização com você", at: now - 25 * min },
    { text: "Novo evento perto de você: Noite no Museu", at: now - 60 * min },
  ];

  return { center: [-25.4285, -49.2700], posts, liveFriends, notifications };
})();
