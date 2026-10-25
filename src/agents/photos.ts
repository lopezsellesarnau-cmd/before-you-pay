import type { LensResult } from '../sources/brightdata.ts';
import type { WorldStore } from '../world/store.ts';

// Photos specialist (code). Each listing photo goes through Google Lens (Bright Data):
// a scam usually reuses pictures of a real flat taken from another listing, a holiday
// rental or a stock site. Only the facts are stored here; the scam check weighs them.

// Sites where a long-term listing's own photos have no reason to be.
const STOCK_OR_HOLIDAY = /shutterstock|istockphoto|gettyimages|depositphotos|dreamstime|alamy|123rf|freepik|unsplash|pexels|pixabay|adobe\.com|airbnb|booking\.com|vrbo|expedia|tripadvisor|hotels\.com/i;
// Rental portals: the same agency may advertise on several, so only another city counts.
const PORTALS = /idealista|fotocasa|habitaclia|pisos\.com|milanuncios|yaencontre|spotahome|badi|wallapop|enalquiler|tucasa|housinganywhere|uniplaces/i;
// Sites showing the same photo from which it stops being a coincidence.
const REUSED_SITES = 5;
const CITIES = ['Madrid', 'Barcelona', 'Valencia', 'Sevilla', 'Málaga', 'Malaga', 'Bilbao', 'Zaragoza', 'Alicante', 'Palma', 'Granada', 'Murcia', 'Valladolid', 'Córdoba', 'Vigo', 'Gijón', 'Lisboa', 'Lisbon', 'Porto', 'Paris', 'London', 'Londres', 'Roma', 'Rome', 'Milano', 'Berlin', 'Dublin'];

export function ingestPhotos(world: WorldStore, results: LensResult[]) {
  const city = String(world.value('address.municipality') ?? '').toLowerCase();
  for (const r of results) {
    const src = world.addSource({
      kind: 'web',
      label: `Google Lens via Bright Data, photo ${results.indexOf(r) + 1}`,
      url: r.lensUrl,
      retrievedAt: r.retrievedAt,
      live: r.live,
    });
    const conf = r.live ? 'high' : 'medium';
    const cite = (ms: typeof r.matches) => ms.slice(0, 3).map((m) => `${m.domain}: ${m.title}`).join(' | ');
    world.addFact({ attribute: 'photos.pages_found', value: r.matches.length, sourceId: src.id, quote: cite(r.matches), confidence: conf });

    const stock = r.matches.filter((m) => STOCK_OR_HOLIDAY.test(m.domain));
    if (stock.length) world.addFact({ attribute: 'photos.on_stock_or_holiday_site', value: true, sourceId: src.id, quote: cite(stock), confidence: conf });

    const elsewhere = r.matches.filter((m) => PORTALS.test(m.domain) && otherCity(`${m.title} ${m.link}`, city));
    if (elsewhere.length) world.addFact({ attribute: 'photos.on_listing_in_other_city', value: true, sourceId: src.id, quote: cite(elsewhere), confidence: conf });

    // A real flat's own photo does not turn up on many unrelated sites.
    const sites = new Set(r.matches.map((m) => m.domain));
    if (sites.size >= REUSED_SITES) world.addFact({ attribute: 'photos.reused_on_sites', value: sites.size, sourceId: src.id, quote: cite(r.matches), confidence: conf });

    const portals = r.matches.filter((m) => PORTALS.test(m.domain));
    if (portals.length && !elsewhere.length) world.addFact({ attribute: 'photos.on_other_portal', value: true, sourceId: src.id, quote: cite(portals), confidence: conf });
  }
}

function otherCity(text: string, city: string) {
  const t = text.toLowerCase();
  return CITIES.some((c) => c.toLowerCase() !== city && new RegExp(`\\b${c.toLowerCase()}\\b`).test(t));
}
