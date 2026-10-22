import { reference } from '../sources/serpavi.ts';
import type { WorldStore } from '../world/store.ts';

// Price specialist (code). Looks up what people actually pay per m² around the flat
// (SERPAVI), most specific area first: census district, then municipality.

export async function lookupReference(world: WorldStore) {
  const mun = world.value<string>('unit.ine_municipality', ['catastro']);
  if (!mun) return { ok: false as const, reason: 'no INE municipality from Catastro' };
  const district = world.value<string>('unit.district', ['catastro']);
  const codes = [district ? `${mun}${district}` : undefined, mun].filter((c): c is string => !!c);
  const dwelling = Number(world.value('building.dwellings', ['catastro']) ?? 2) > 1 ? 'colectiva' : 'unifamiliar';

  const { ref, error } = await reference(codes, dwelling);
  if (!ref) return { ok: false as const, reason: error ?? 'no SERPAVI row for this area' };

  const src = world.addSource({
    kind: 'serpavi',
    label: `SERPAVI ${ref.year}, ${ref.areaName} ${ref.level === 'distrito_censal' ? `census district ${ref.areaCode.slice(5)}` : 'municipality'}`,
    url: 'https://www.mivau.gob.es/vivienda/alquila-bien-es-tu-derecho/serpavi',
    version: `dataset 2011-2024, via ${ref.via}`,
    retrievedAt: new Date().toISOString(),
    live: ref.via === 'zetaris',
  });
  const conf = ref.sampleN >= 30 ? 'high' : 'low';
  const add = (attribute: string, value: number | string, unit?: string) =>
    world.addFact({ attribute, value, unit, sourceId: src.id, confidence: conf });
  add('ref.eur_m2_p25', ref.p25, '€/m²/month');
  add('ref.eur_m2_p50', ref.p50, '€/m²/month');
  add('ref.eur_m2_p75', ref.p75, '€/m²/month');
  add('ref.sample_n', ref.sampleN, 'leases');
  add('ref.level', ref.level);
  return { ok: true as const, ref, fellBack: codes[0] !== ref.areaCode, error };
}
