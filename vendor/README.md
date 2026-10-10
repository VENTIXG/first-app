# Bundled third-party libraries

Local copies so the calculator works offline and in the desktop app without
contacting a CDN. Pinned to the versions in `package.json`; refresh with
`npm run vendor` after changing those versions.

| File | Package | Version | Licence |
|---|---|---|---|
| `plotly-2.35.2.min.js` | plotly.js-dist-min (`plotly.min.js`) | 2.35.2 | MIT (`licenses/plotly.js-LICENSE.txt`) |
| `jspdf-4.2.1.umd.min.js` | jspdf (`dist/jspdf.umd.min.js`) | 4.2.1 | MIT (`licenses/jspdf-LICENSE.txt`) |
| `three-0.160.0.module.js` | three (`build/three.module.js`) | 0.160.0 | MIT (`licenses/three-LICENSE.txt`) |

The only change to the upstream files is the removal of the trailing
`sourceMappingURL` comment (the source maps are not shipped).
