import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ingestPhotos } from '../src/agents/photos.ts';
import { CHECKS } from '../src/checks/index.ts';
import { parseLens } from '../src/sources/brightdata.ts';
import { WorldStore } from '../src/world/store.ts';

// Shape is illustrative: the parser only relies on objects with a web link and a title.
const lensBody = JSON.stringify({
  general: { query: 'lens' },
  exact_matches: [
    { title: 'Bright apartment in Lisbon - Airbnb', link: 'https://www.airbnb.com/rooms/123', source: 'Airbnb' },
    { title: 'Piso en alquiler en Valencia', link: 'https://www.idealista.com/inmueble/999/', source: 'idealista' },
    { title: 'Google', link: 'https://www.google.com/search?q=x' },
  ],
  related: { items: [{ name: 'Modern living room stock photo', url: 'https://www.shutterstock.com/image-photo/1' }] },
});

test('lens parser: real shape, Google redirect links with the site in source/display_link', () => {
  const body = JSON.stringify({
    tabs: [{ name: 'Exact matches', link: 'https://lens.google.com/search?ep=x' }],
    images: [{ title: 'Casa à venda | OLX', link: 'https://lens.google.com/goto?url=AAA', source: 'OLX' }],
    organic: [{ title: 'Rent out an apartment in Zurich', link: 'https://lens.google.com/goto?url=BBB', display_link: 'https://apartments.zuerich › rent', source: 'apartments.zuerich' }],
  });
  assert.deepEqual(parseLens(body).map((m) => m.domain), ['olx', 'apartments.zuerich']);
});

test('lens parser: keeps web pages wherever they sit, drops Google', () => {
  const m = parseLens(lensBody);
  assert.deepEqual(m.map((x) => x.domain).sort(), ['airbnb.com', 'idealista.com', 'shutterstock.com']);
  assert.deepEqual(parseLens('not json'), []);
});

test('photos found on holiday and other-city listings make the scam check red', () => {
  const w = new WorldStore();
  const listing = w.addSource({ kind: 'listing', label: 'Listing', retrievedAt: '', live: true });
  w.addFact({ attribute: 'address.municipality', value: 'Madrid', sourceId: listing.id, quote: '(Madrid)', confidence: 'high' });
  ingestPhotos(w, [{ imageUrl: 'https://x/1.jpg', lensUrl: 'https://lens.google.com/uploadbyurl?url=x', matches: parseLens(lensBody), live: true, retrievedAt: '' }]);

  assert.equal(w.value('photos.pages_found'), 3);
  assert.equal(w.value('photos.on_stock_or_holiday_site'), true);
  assert.equal(w.value('photos.on_listing_in_other_city'), true);
  const scam = CHECKS.find((c) => c.id === 'scam')!.run(w)!;
  assert.equal(scam.status, 'red');
  assert.match(scam.detail, /stock-photo or holiday-rental site/);
  assert.match(scam.detail, /listing in another city/);
});

test('photos only on another portal in the same city are a weak signal', () => {
  const w = new WorldStore();
  const listing = w.addSource({ kind: 'listing', label: 'Listing', retrievedAt: '', live: true });
  w.addFact({ attribute: 'address.municipality', value: 'Madrid', sourceId: listing.id, quote: '(Madrid)', confidence: 'high' });
  const matches = [{ title: 'Piso en Lavapiés, Madrid', link: 'https://www.fotocasa.es/es/alquiler/vivienda/madrid/1', domain: 'fotocasa.es' }];
  ingestPhotos(w, [{ imageUrl: 'https://x/1.jpg', lensUrl: 'https://lens', matches, live: true, retrievedAt: '' }]);
  assert.equal(CHECKS.find((c) => c.id === 'scam')!.run(w)!.status, 'amber');
});

test('a photo reused on many unrelated sites is a strong scam signal', () => {
  const w = new WorldStore();
  const matches = ['a.com', 'b.com', 'c.com', 'd.com', 'e.com'].map((d, i) => ({ title: `Page ${i}`, link: `https://${d}/x`, domain: d }));
  ingestPhotos(w, [{ imageUrl: 'https://x/1.jpg', lensUrl: 'https://lens', matches, live: true, retrievedAt: '' }]);
  const scam = CHECKS.find((c) => c.id === 'scam')!.run(w)!;
  assert.equal(scam.status, 'red');
  assert.match(scam.detail, /same photo appears on 5 different websites/);
});
