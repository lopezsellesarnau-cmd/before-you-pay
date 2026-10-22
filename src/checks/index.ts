import type { WorldStore } from '../world/store.ts';
import type { Fact, Finding } from '../world/types.ts';

// Deterministic checks. Plain code, no model: same inputs, same verdict.
// Each check declares the facts it needs; with a fact missing it returns "unknown"
// plus the question that would fill the gap, never a guess.

const DOCS = ['renter', 'contract', 'listing'] as const;

export interface Check {
  id: string;
  title: string;
  /** Law attributes the law specialist must fetch for this check. */
  law: string[];
  run(w: WorldStore): Finding | undefined;
}

const eur = (n: number) => `${n.toLocaleString('es-ES')} €`;
const ids = (...fs: (Fact | undefined)[]) => fs.filter((f): f is Fact => !!f).map((f) => f.id);

// Listing m² over Catastro m² construidos. Catastro already counts walls and a share
// of common areas, so an honest listing is at or below it. 10% covers rounding and
// small extensions; above 20% the extra space is not on record.
const AREA_AMBER = 1.1;
const AREA_RED = 1.2;

export const CHECKS: Check[] = [
  {
    id: 'area',
    title: 'Advertised size vs Catastro',
    law: [],
    run(w) {
      const ad = w.get('unit.area_m2', [...DOCS]);
      const rec = w.get('unit.area_m2', ['catastro']);
      if (!ad || !rec) return;
      const ratio = Number(ad.value) / Number(rec.value);
      const pct = Math.round((ratio - 1) * 100);
      const status = ratio > AREA_RED ? 'red' : ratio > AREA_AMBER ? 'amber' : 'green';
      return {
        checkId: 'area',
        status,
        title: this.title,
        detail:
          status === 'green'
            ? `Advertised ${ad.value} m², Catastro records ${rec.value} m² construidos.`
            : `Advertised ${ad.value} m², Catastro records ${rec.value} m² construidos: ${pct}% more than on record.`,
        evidence: ids(ad, rec),
        question: status === 'green' ? undefined : `Catastro has this flat at ${rec.value} m². Where do the other ${Number(ad.value) - Number(rec.value)} m² come from, and are they legalised?`,
      };
    },
  },
  {
    id: 'use',
    title: 'Registered as a dwelling',
    law: [],
    run(w) {
      const use = w.get('unit.use', ['catastro']);
      if (!use) return;
      const ok = use.value === 'Residencial';
      return {
        checkId: 'use',
        status: ok ? 'green' : 'red',
        title: this.title,
        detail: ok ? 'Catastro registers the unit as Residencial.' : `Catastro registers the unit as ${use.value}, not as a dwelling.`,
        evidence: ids(use),
        question: ok ? undefined : `The unit is registered as ${use.value}. Does it have a cédula de habitabilidad or licencia de primera ocupación as a dwelling?`,
      };
    },
  },
  {
    id: 'deposit',
    title: 'Fianza (deposit)',
    law: ['law.max_deposit_months'],
    run(w) {
      const dep = w.get('terms.deposit_months', [...DOCS]);
      if (!dep) return;
      const type = w.get('terms.rental_type', [...DOCS]);
      const max = w.get('law.max_deposit_months');
      if (type?.value === 'temporada') {
        return {
          checkId: 'deposit',
          status: 'unknown',
          title: this.title,
          detail: `Seasonal contract with a ${dep.value}-month fianza; the 1-month cap applies to residential leases.`,
          evidence: ids(dep, type),
          question: 'Is this a seasonal lease (with a written, provable reason) or a residential one?',
        };
      }
      if (!max) return unknownLaw('deposit', this.title, dep);
      const over = Number(dep.value) > Number(max.value);
      return {
        checkId: 'deposit',
        status: over ? 'red' : 'green',
        title: this.title,
        detail: over
          ? `Asks for ${dep.value} months of fianza; the law sets ${max.value} month for housing.`
          : `Fianza of ${dep.value} month, as the law sets.`,
        evidence: ids(dep, max),
        question: over ? `The legal fianza is ${max.value} month of rent. Anything above that has to be an additional guarantee, capped too. Can you correct it?` : undefined,
      };
    },
  },
  {
    id: 'extra_guarantee',
    title: 'Additional guarantee',
    law: ['law.max_extra_guarantee_months', 'law.max_extra_guarantee_months_temporada'],
    run(w) {
      const g = w.get('terms.extra_guarantee_months', [...DOCS]);
      if (!g) return;
      const seasonal = w.value('terms.rental_type', [...DOCS]) === 'temporada';
      const max = w.get(seasonal ? 'law.max_extra_guarantee_months_temporada' : 'law.max_extra_guarantee_months');
      if (!max) return unknownLaw('extra_guarantee', this.title, g);
      const over = Number(g.value) > Number(max.value);
      return {
        checkId: 'extra_guarantee',
        status: over ? 'red' : 'green',
        title: this.title,
        detail: over
          ? `Asks for ${g.value} months of additional guarantee; the cap is ${max.value}.`
          : `Additional guarantee of ${g.value} months, within the cap of ${max.value}.`,
        evidence: ids(g, max),
        question: over ? `The additional guarantee cannot exceed ${max.value} months of rent. Can it be reduced?` : undefined,
      };
    },
  },
  {
    id: 'rent_insurance',
    title: 'Rent default insurance',
    law: ['law.rent_insurance_forbidden'],
    run(w) {
      const ins = w.get('terms.rent_insurance_required', [...DOCS]);
      if (!ins || ins.value !== true) return;
      const law = w.get('law.rent_insurance_forbidden');
      if (!law) return unknownLaw('rent_insurance', this.title, ins);
      return {
        checkId: 'rent_insurance',
        status: 'red',
        title: this.title,
        detail: 'Requires the tenant to take out rent default insurance (seguro de impago), which the law no longer allows.',
        evidence: ids(ins, law),
        question: 'The law does not allow requiring a seguro de impago from the tenant. Will you drop it?',
      };
    },
  },
  {
    id: 'agency_fees',
    title: 'Agency fees',
    law: ['law.agency_fees_forbidden'],
    run(w) {
      const fee = w.get('terms.agency_fee_to_tenant', [...DOCS]);
      if (!fee || fee.value !== true) return;
      const amount = w.get('terms.agency_fee_eur', [...DOCS]);
      const law = w.get('law.agency_fees_forbidden');
      if (!law) return unknownLaw('agency_fees', this.title, fee);
      return {
        checkId: 'agency_fees',
        status: 'red',
        title: this.title,
        detail: `Charges the tenant agency or contract fees${amount ? ` of ${eur(Number(amount.value))}` : ''}; these are the landlord's by law.`,
        evidence: ids(fee, amount, law),
        question: 'Agency and contract fees cannot be passed on to the tenant. Will the landlord pay them?',
      };
    },
  },
  {
    id: 'taxes',
    title: 'Property tax (IBI)',
    law: ['law.taxes_to_tenant_forbidden'],
    run(w) {
      const tax = w.get('terms.taxes_to_tenant', [...DOCS]);
      if (!tax || tax.value !== true) return;
      const law = w.get('law.taxes_to_tenant_forbidden');
      if (!law) return unknownLaw('taxes', this.title, tax);
      return {
        checkId: 'taxes',
        status: 'red',
        title: this.title,
        detail: 'Passes IBI or other property taxes to the tenant, which the law no longer allows.',
        evidence: ids(tax, law),
        question: 'Property taxes such as IBI cannot be charged to the tenant. Can that clause go?',
      };
    },
  },
  {
    id: 'price',
    title: 'Rent vs what people pay nearby',
    law: [],
    run(w) {
      const rent = w.get('terms.rent_eur', [...DOCS]);
      const p50 = w.get('ref.eur_m2_p50');
      const p75 = w.get('ref.eur_m2_p75');
      if (!rent || !p50 || !p75) return;
      // Per m² on the surface on record when we have it: that is the space being paid for.
      const area = w.get('unit.area_m2', ['catastro']) ?? w.get('unit.area_m2', [...DOCS]);
      if (!area) return;
      const perM2 = Math.round((Number(rent.value) / Number(area.value)) * 100) / 100;
      const above = perM2 > Number(p75.value);
      const onRecord = w.sourceOf(area).kind === 'catastro';
      return {
        checkId: 'price',
        status: above ? 'amber' : 'green',
        title: this.title,
        detail: `${eur(Number(rent.value))} for ${area.value} m²${onRecord ? ' on record' : ''} is ${perM2} €/m²; in this area half of leases pay under ${p50.value} €/m² and three in four under ${p75.value} €/m².`,
        evidence: ids(rent, area, p50, p75),
        question: above ? `The rent is above what three in four leases in the area pay per m². What justifies it?` : undefined,
      };
    },
  },
  {
    id: 'consistency',
    title: 'Listing vs contract',
    law: [],
    run(w) {
      const diffs: Fact[] = [];
      for (const attr of ['terms.rent_eur', 'terms.deposit_months', 'unit.area_m2', 'terms.extra_guarantee_months']) {
        const l = w.get(attr, ['listing']);
        const c = w.get(attr, ['contract']);
        if (l && c && l.value !== c.value) diffs.push(l, c);
      }
      if (!w.has('terms.rent_eur', ['contract'])) return;
      return {
        checkId: 'consistency',
        status: diffs.length ? 'amber' : 'green',
        title: this.title,
        detail: diffs.length
          ? `The contract and the listing disagree on ${[...new Set(diffs.map((d) => d.attribute))].join(', ')}.`
          : 'The contract repeats the listing on rent, deposit and size.',
        evidence: diffs.length ? ids(...diffs) : ids(w.get('terms.rent_eur', ['contract'])),
        question: diffs.length ? 'The contract does not match the listing. Which figures are the real ones?' : undefined,
      };
    },
  },
];

function unknownLaw(checkId: string, title: string, f: Fact): Finding {
  return {
    checkId,
    status: 'unknown',
    title,
    detail: 'The rule could not be confirmed in the version of the LAU in force today.',
    evidence: [f.id],
  };
}
