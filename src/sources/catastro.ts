import { fetchWithFallback } from './http.ts';

// Catastro OVC web services: free, no key.
const BASE = 'https://ovc.catastro.meh.es/OVCServWeb/OVCWcfCallejero';

export interface CatastroUnit {
  ref: string;
  address: string;
  floor: string;
  door: string;
  use: string;
  areaM2: number;
  year: number;
  /** INE municipality code, e.g. 28079 (Madrid). Joins with SERPAVI and the stressed-zone list. */
  ineMunicipality: string;
  /** Municipal district number as Catastro gives it ("1" = Centro in Madrid). */
  district: string;
}

export interface CatastroResult {
  url: string;
  live: boolean;
  retrievedAt: string;
  units: CatastroUnit[];
  error?: string;
}

export interface AddressQuery {
  province: string;
  municipality: string;
  /** Street type code: CL, AV, PZ, PS… */
  streetType: string;
  street: string;
  number: string;
}

export async function byAddress(q: AddressQuery): Promise<CatastroResult> {
  const p = new URLSearchParams({
    Provincia: q.province.toUpperCase(),
    Municipio: q.municipality.toUpperCase(),
    Sigla: q.streetType.toUpperCase(),
    Calle: q.street.toUpperCase(),
    Numero: q.number,
  });
  return query(`${BASE}/COVCCallejero.svc/json/Consulta_DNPLOC?${p}`);
}

export async function byReference(ref: string): Promise<CatastroResult> {
  return query(`${BASE}/COVCCallejero.svc/json/Consulta_DNPRC?RefCat=${encodeURIComponent(ref)}`);
}

/** Coordinates → 14-char parcel reference. */
export async function referenceAt(lat: number, lon: number): Promise<string | undefined> {
  const url = `${BASE}/COVCCoordenadas.svc/json/Consulta_RCCOOR?CoorX=${lon}&CoorY=${lat}&SRS=EPSG:4326`;
  const { body } = await fetchWithFallback(url);
  const pc = JSON.parse(body)?.Consulta_RCCOORResult?.coordenadas?.coord?.[0]?.pc;
  return pc ? pc.pc1 + pc.pc2 : undefined;
}

async function query(url: string): Promise<CatastroResult> {
  const { body, live, retrievedAt } = await fetchWithFallback(url);
  const json = JSON.parse(body);
  const result = json.consulta_dnplocResult ?? json.consulta_dnprcResult;
  const err = result?.lerr?.err?.[0]?.des;
  if (err) return { url, live, retrievedAt, units: [], error: err };

  // One unit comes back as `bico`; several as `lrcdnp.rcdnp`.
  const raw = result?.lrcdnp?.rcdnp ?? (result?.bico ? [result.bico.bi] : []);
  const units = raw.map((u: any): CatastroUnit => {
    const rc = u.rc ?? u.idbi?.rc;
    const loc = u.dt.locs.lous.lourb;
    return {
      ref: rc.pc1 + rc.pc2 + rc.car + rc.cc1 + rc.cc2,
      address: `${loc.dir.tv} ${loc.dir.nv} ${loc.dir.pnp}, ${u.dt.nm}`,
      floor: normFloor(loc.loint?.pt ?? ''),
      door: (loc.loint?.pu ?? '').trim(),
      use: u.debi.luso,
      areaM2: Number(u.debi.sfc),
      year: Number(u.debi.ant),
      ineMunicipality: String(u.dt.loine.cp).padStart(2, '0') + String(u.dt.loine.cm).padStart(3, '0'),
      district: String(loc.dm ?? ''),
    };
  });
  return { url, live, retrievedAt, units };
}

/** "03" → "3", "00" → "0", "BJ" stays. */
export function normFloor(pt: string): string {
  const t = pt.trim().toUpperCase();
  return /^\d+$/.test(t) ? String(Number(t)) : t;
}
