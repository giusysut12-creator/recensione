/**
 * Dati SINTETICI per il test end-to-end locale (non sono recensioni reali).
 * Formato: righe come quelle dell'Actor Apify Google Maps Reviews Scraper.
 * Contengono pattern noti (personale, pizza, attesa in aumento, prezzo, prenotazione,
 * senza glutine) così il test può verificare che la pipeline li ritrovi.
 */
const place = {
  placeId: "ChIJ_TEST_PIZZERIA",
  title: "Pizzeria Il Forno (test)",
  categoryName: "Pizzeria",
  address: "Via di Prova 1, Milano",
  totalScore: 4.2,
  reviewsCount: 64,
  url: "https://www.google.com/maps/place/?q=place_id:ChIJ_TEST_PIZZERIA",
};

const positives = [
  "Pizza buonissima, impasto leggero e digeribile. Il personale è gentilissimo.",
  "Il personale è gentilissimo e attento. Torneremo sicuramente per la pizza!",
  "Impasto leggero e digeribile, ingredienti di qualità. Prezzi giusti.",
  "Ci veniamo da anni perché la pizza è sempre ottima. Il personale è gentilissimo.",
  "Serviti in pochi minuti anche di sabato sera. Pizza buonissima.",
  "Locale accogliente, impasto leggero e digeribile. Lo consiglio a tutti.",
  "Abbiamo scelto questo posto perché è vicino a casa, e non ci ha deluso: pizza buonissima.",
  "Serviti in pochi minuti, personale simpatico. Sarebbe bello avere più opzioni senza glutine.",
];
const negatives = [
  "Abbiamo aspettato quaranta minuti per una pizza. Inaccettabile.",
  "Abbiamo aspettato quaranta minuti e nessuno ci ha avvisato. Il cameriere era scortese.",
  "Prenotazione non registrata: non si capisce come funziona la prenotazione online. Abbiamo aspettato quaranta minuti.",
  "Pizza fredda e abbiamo aspettato quaranta minuti. Mi aspettavo molto di più dopo le recensioni.",
  "Un po' caro per una pizza margherita. Abbiamo aspettato quaranta minuti.",
];
const mixed = [
  "Pizza buonissima ma un po' caro rispetto alla zona.",
  "Non si capisce come funziona la prenotazione online, però la pizza è buonissima.",
  "Cercavo un posto con opzioni senza glutine: poche scelte. Sarebbe bello avere più opzioni senza glutine.",
];

export function buildFixture() {
  const items = [];
  const start = Date.UTC(2024, 6, 1);
  const day = 864e5;
  let n = 0;
  const push = (stars, text, i) => {
    n++;
    items.push({
      ...place,
      reviewId: `test-review-${n}`,
      name: `Cliente${n} Prova`,
      reviewerId: `reviewer-${n}`,
      reviewerPhotoUrl: "https://example.invalid/photo.jpg",
      stars,
      text,
      publishedAtDate: new Date(start + i * day).toISOString(),
      responseFromOwnerText: n % 3 === 0 ? "Grazie per averci scritto!" : null,
      reviewUrl: `https://www.google.com/maps/reviews/test-${n}`,
    });
  };
  // 40 positive distribuite su tutto il periodo
  for (let i = 0; i < 40; i++) push(i % 5 === 0 ? 4 : 5, positives[i % positives.length], i * 11);
  // negative concentrate nell'ultimo periodo (attesa in aumento)
  for (let i = 0; i < 12; i++) push(i % 3 === 0 ? 2 : 1, negatives[i % negatives.length], 300 + i * 12);
  for (let i = 0; i < 6; i++) push(3, mixed[i % mixed.length], 100 + i * 40);
  // solo voto, senza testo
  for (let i = 0; i < 5; i++) push(5, null, 50 + i * 30);
  // duplicato (deve essere scartato) e riga senza voto
  items.push({ ...items[0] });
  items.push({ ...place, reviewId: null, stars: null, text: null });
  return items;
}
