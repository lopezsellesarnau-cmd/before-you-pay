"""SERPAVI Excel (wide, one column per year) -> long CSV for the byp_pg database.

    python3 -m pip install openpyxl
    python3 scripts/prepare_serpavi.py data/serpavi/serpavi_2011-2024.xlsx data/serpavi/serpavi_long.csv

Source: Ministerio de Vivienda y Agenda Urbana, Sistema Estatal de Referencia del Precio
del Alquiler de Vivienda (SERPAVI), 2011-2024. Rents declared in IRPF (Modelo 100), so it
is a reference of what is paid, not a cap and not asking prices.
"""
import csv
import sys

import openpyxl

YEARS = range(2020, 2025)  # recent years only; the check uses the latest available
SHEETS = {  # sheet -> (level, code column, name column, municipality column)
    'Municipios': ('municipio', 'CUMUN', 'NMUN', 'CUMUN'),
    'Distritos': ('distrito_censal', 'CUDIS', 'LITMUN', 'CUMUN'),
}


def main(src, dst):
    wb = openpyxl.load_workbook(src, read_only=True)
    n = 0
    with open(dst, 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['area_code', 'area_level', 'area_name', 'municipality_code', 'year', 'dwelling',
                    'eur_m2_p25', 'eur_m2_p50', 'eur_m2_p75', 'eur_month_p25', 'eur_month_p50', 'eur_month_p75',
                    'area_m2_p50', 'sample_n'])
        for sheet, (level, code_col, name_col, mun_col) in SHEETS.items():
            rows = wb[sheet].iter_rows(values_only=True)
            head = {h: i for i, h in enumerate(next(rows))}
            for r in rows:
                for y in YEARS:
                    yy = f'{y % 100:02d}'
                    for d, tag in (('colectiva', 'VC'), ('unifamiliar', 'VU')):
                        g = lambda k: r[head[f'{k}_{tag}_{yy}']] if f'{k}_{tag}_{yy}' in head else None
                        p50 = g('ALQM2_LV_M')
                        if p50 in (None, ''):
                            continue
                        w.writerow([r[head[code_col]], level, r[head[name_col]], r[head[mun_col]], y, d,
                                    rnd(g('ALQM2_LV_25')), rnd(p50), rnd(g('ALQM2_LV_75')),
                                    rnd(g('ALQTBID12_25')), rnd(g('ALQTBID12_M')), rnd(g('ALQTBID12_75')),
                                    rnd(g('SLVM2_M')), r[head[f'BI_ALVHEPCO_T{tag}_{yy}']]])
                        n += 1
    print(f'{n} rows -> {dst}')


def rnd(v):
    return None if v in (None, '') else round(float(v), 2)


if __name__ == '__main__':
    main(*sys.argv[1:3])
