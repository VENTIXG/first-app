"""Generate independent mooring reference results with MoorPy.

Usage:  python3 scripts/mooring-reference.py   (needs `pip install moorpy==1.3.0`)
Writes: tests/fixtures/moorpy-reference.json

The TypeScript mooring solver (studio/src/core/mooring) is compared against
these numbers in tests/unit/studio/mooring.test.ts. Nothing here is hand-typed:
every value is computed by MoorPy at generation time.
"""
import json
import math
import os
import platform

import moorpy
import numpy as np
from moorpy.Catenary import catenary
from moorpy.helpers import getLineProps

OUT = os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures', 'moorpy-reference.json')

ref = {
    'generator': 'scripts/mooring-reference.py',
    'moorpy_version': getattr(moorpy, '__version__', '1.3.0'),
    'python': platform.python_version(),
    'numpy': np.__version__,
}

# 1. line properties from MoorPy's default coefficient library
props = []
for material in ['chain', 'chain_studlink', 'wire', 'polyester', 'nylon', 'hmpe']:
    for dmm in [60, 120, 180]:
        p = getLineProps(dmm, material, source=os.path.join(os.path.dirname(moorpy.__file__), 'library', 'MoorProps_default.yaml'))
        props.append({'material': material, 'dnommm': dmm, 'mass': float(p['m']), 'w': float(p['w']),
                      'EA': float(p['EA']), 'MBL': float(p['MBL'])})
ref['lineProps'] = props

# 2. single-line catenary, anchor at end A on the seabed (CB = 0: no friction)
EA, W = 1.2e9, 2450.0
cases = []
for XF, ZF, L in [(800, 250, 900), (850, 250, 880), (700, 300, 800), (500, 150, 560),
                  (300, 200, 400), (880, 250, 900), (1200, 600, 1400), (400, 100, 498)]:
    fAH, fAV, fBH, fBV, info = catenary(XF, ZF, L, EA, W, CB=0, Tol=1e-10, MaxIter=200)
    cases.append({'XF': XF, 'ZF': ZF, 'L': L, 'EA': EA, 'w': W,
                  'HF': float(info['HF']), 'VF': float(info['VF']),
                  'HA': float(abs(fAH)), 'VA': float(abs(fAV)),
                  'LBot': float(info.get('LBot', 0.0)),
                  'stiffnessB': np.asarray(info['stiffnessB']).tolist()})
ref['catenary'] = cases

# 3. three-line spread mooring (OC3-Hywind-like geometry; Jonkman 2010, NREL/TP-500-47971)
depth, rA, rF, zF, L = 320.0, 853.87, 5.2, -70.0, 902.2
lt = {'EA': 384.243e6, 'w': 698.094}
ms = moorpy.System(depth=depth)
# dnommm is passed only to work around an unset d_nom in MoorPy 1.3.0 setLineType
ms.setLineType(name='oc3', dnommm=90, d_vol=0.09, mass=(lt['w'] / 9.81 + 1025 * math.pi / 4 * 0.09 ** 2),
               w=lt['w'], EA=lt['EA'])
ms.addBody(-1, [0, 0, 0, 0, 0, 0])
for i in range(3):
    a = math.radians(180 + 120 * i)
    ms.addPoint(1, [rA * math.cos(a), rA * math.sin(a), -depth])
    ms.addPoint(1, [rF * math.cos(a), rF * math.sin(a), zF])
    ms.bodyList[0].attachPoint(2 * i + 2, [rF * math.cos(a), rF * math.sin(a), zF])
    ms.addLine(L, 'oc3', pointA=2 * i + 1, pointB=2 * i + 2)
ms.initialize()
w_check = ms.lineTypes['oc3']['w']
poses = [[0, 0, 0, 0, 0, 0], [10, 0, 0, 0, 0, 0], [25, 0, 0, 0, 0, 0], [-15, 0, 0, 0, 0, 0],
         [0, 12, 0, 0, 0, 0], [8, -6, 0, 0, 0, 0.05], [0, 0, 0, 0, 0, 0.1]]
forces = []
for r6 in poses:
    ms.bodyList[0].setPosition(r6)
    for line in ms.lineList:
        line.staticSolve()
    f = ms.bodyList[0].getForces(lines_only=True)
    tens = [float(max(line.TA, line.TB)) for line in ms.lineList]
    fair = [float(line.TB) for line in ms.lineList]
    forces.append({'pose': r6, 'force': [float(v) for v in f], 'fairleadTension': fair})
ref['spread3'] = {
    'depth': depth, 'anchorRadius': rA, 'fairleadRadius': rF, 'fairleadZ': zF, 'length': L,
    'EA': lt['EA'], 'w': float(w_check), 'headingsDeg': [180, 300, 60],
    'source': 'geometry and line properties of the OC3-Hywind mooring (Jonkman 2010); delta-connection omitted',
    'cases': forces,
}

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w') as fh:
    json.dump(ref, fh, indent=1)
print('wrote', os.path.relpath(OUT))
