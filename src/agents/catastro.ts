import { byAddress, byReference, normFloor, referenceAt, type CatastroResult, type CatastroUnit } from '../sources/catastro.ts';
import type { WorldStore } from '../world/store.ts';

// Catastro specialist (code). Finds the registered unit behind the listing and writes
// its surface, use and year into the world under the same attribute names the listing
// uses, so the reconciler can compare them directly.

export type Strategy = 'reference' | 'address' | 'address-normalised' | 'coordinates';

export async function lookup(world: WorldStore, strategy: Strategy): Promise<CatastroResult | undefined> {
  const v = (a: string) => world.value<string>(a, ['renter', 'contract', 'listing']);
  if (strategy === 'reference') {
    const ref = v('unit.catastro_ref');
    return ref ? byReference(String(ref).replace(/\s/g, '').slice(0, 20)) : undefined;
  }
  if (strategy === 'coordinates') {
    const lat = world.value<number>('address.lat');
    const lon = world.value<number>('address.lon');
    if (lat == null || lon == null) return undefined;
    const ref = await referenceAt(lat, lon);
    return ref ? byReference(ref) : undefined;
  }
  const street = v('address.street');
  const number = v('address.number');
  if (!street || !number) return undefined;
  const q = {
    province: v('address.province') ?? v('address.municipality') ?? '',
    municipality: v('address.municipality') ?? '',
    streetType: v('address.street_type') ?? 'CL',
    street: String(street),
    number: String(number),
  };
  if (strategy === 'address-normalised') {
    q.street = stripAccents(q.street).replace(/^(DE |DEL |DE LA |DE LOS |DE LAS )/i, '');
    q.province = stripAccents(q.province);
    q.municipality = stripAccents(q.municipality);
  }
  return byAddress(q);
}

/** Units of the building that match the floor/door the renter was given. */
export function match(world: WorldStore, units: CatastroUnit[]): CatastroUnit[] {
  const floor = world.value<string>('address.floor', ['renter', 'contract', 'listing']);
  const door = world.value<string>('address.door', ['renter', 'contract', 'listing']);
  const onFloor = units.filter((u) => (floor == null || u.floor === normFloor(String(floor))));
  return door == null ? onFloor : onFloor.filter((u) => u.door.toUpperCase() === String(door).toUpperCase());
}

export function ingestUnit(world: WorldStore, r: CatastroResult, u: CatastroUnit, building: CatastroUnit[]) {
  const src = world.addSource({
    kind: 'catastro',
    label: `Catastro, ref. ${u.ref}`,
    url: `https://www1.sedecatastro.gob.es/CYCBienInmueble/OVCConCiud.aspx?RefC=${u.ref}`,
    retrievedAt: r.retrievedAt,
    live: r.live,
  });
  const conf = r.live ? 'high' : 'medium';
  const add = (attribute: string, value: string | number, unit?: string) =>
    world.addFact({ attribute, value, unit, sourceId: src.id, confidence: conf });
  add('unit.catastro_ref', u.ref);
  add('unit.area_m2', u.areaM2, 'm² construidos');
  add('unit.use', u.use);
  add('unit.year', u.year);
  add('unit.floor', u.floor);
  add('unit.door', u.door);
  add('unit.ine_municipality', u.ineMunicipality);
  if (u.district) add('unit.district', u.district.padStart(2, '0'));
  add('building.units', building.length);
  add('building.dwellings', building.filter((b) => b.use === 'Residencial').length);
}

function stripAccents(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}
