-- Reference rents (SERPAVI, Ministerio de Vivienda), long format from scripts/prepare_serpavi.py.
-- Rents declared in IRPF for habitual-residence leases: a reference of what is paid.
CREATE TABLE serpavi_rent (
  area_code         text NOT NULL,     -- INE municipality (5) or census district (7)
  area_level        text NOT NULL,     -- 'municipio' | 'distrito_censal'
  area_name         text,
  municipality_code text NOT NULL,
  year              int  NOT NULL,
  dwelling          text NOT NULL,     -- 'colectiva' (flat) | 'unifamiliar' (house)
  eur_m2_p25        numeric,
  eur_m2_p50        numeric,
  eur_m2_p75        numeric,
  eur_month_p25     numeric,
  eur_month_p50     numeric,
  eur_month_p75     numeric,
  area_m2_p50       numeric,
  sample_n          int,
  PRIMARY KEY (area_code, year, dwelling)
);

-- Municipalities declared zona de mercado residencial tensionado, from BOE resolutions.
CREATE TABLE stressed_zones (
  municipality_code text PRIMARY KEY,
  municipality      text NOT NULL,
  region            text,
  boe_ref           text NOT NULL,     -- e.g. BOE-A-2026-9175
  in_force_from     date NOT NULL
);
