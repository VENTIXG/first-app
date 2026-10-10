// Builds .3dm files with McNeel's rhino3dm library (the same openNURBS code
// Rhino uses to write files) for the importer tests. The files are generated,
// not saved by Rhino itself: render meshes that Rhino would store with every
// Brep are present only where a test attaches them explicitly.

import rhino3dm from 'rhino3dm';

let rhinoPromise;
export function loadRhino() {
  rhinoPromise ??= rhino3dm();
  return rhinoPromise;
}

/**
 * The reference model, drawn in millimetres:
 *  - "Column A" (layer Platform::Columns): capped Brep cylinder, D 6000, z -20000…15000, centre (0, 0)
 *  - "Column B" (same layer): Extrusion cylinder, D 6000, z -20000…15000, centre (60000, 0)
 *  - "Buoy" (layer Platform::Buoys): sphere R 5000 centred (0, 40000, 0)
 *  - "Brace" (layer Platform::Bracing): capped cylinder R 500, length 30000, tilted 30° about y
 *  - "Tube" (layer Platform::Open): uncapped cylinder (not a solid)
 *  - "Deck" (layer Topside): box 0…20000 × 0…10000 × 16000…18000 with render meshes on all faces
 *  - "Hull mesh" (layer Topside): closed tetrahedron Mesh
 *  - "Centreline" (layer Notes): line curve
 *  - "Hidden column" (layer Hidden, layer off): capped cylinder D 2000, z -5000…5000, centre (-30000, 0)
 */
export async function referenceModel({ units = 'Millimeters' } = {}) {
  const rhino = await loadRhino();
  const doc = new rhino.File3dm();
  doc.settings().modelUnitSystem = rhino.UnitSystem[units];

  const layer = (name, parentId, visible = true) => {
    const L = new rhino.Layer();
    L.name = name;
    if (parentId) L.parentLayerId = parentId;
    L.visible = visible;
    const index = doc.layers().add(L);
    return { index, id: doc.layers().get(index).id };
  };
  const platform = layer('Platform');
  const columns = layer('Columns', platform.id);
  const buoys = layer('Buoys', platform.id);
  const bracing = layer('Bracing', platform.id);
  const open = layer('Open', platform.id);
  const topside = layer('Topside');
  const notes = layer('Notes');
  const hidden = layer('Hidden', null, false);

  const add = (geometry, name, layerIndex) => {
    const a = new rhino.ObjectAttributes();
    a.name = name;
    a.layerIndex = layerIndex;
    return doc.objects().add(geometry, a);
  };
  const cylinder = (cx, cy, z0, r, h) => new rhino.Cylinder(new rhino.Circle([cx, cy, z0], r), h);

  add(cylinder(0, 0, -20000, 3000, 35000).toBrep(true, true), 'Column A', columns.index);
  add(rhino.Extrusion.createCylinderExtrusion(cylinder(60000, 0, -20000, 3000, 35000), true, true), 'Column B', columns.index);
  add(new rhino.Sphere([0, 40000, 0], 5000).toBrep(), 'Buoy', buoys.index);
  const brace = cylinder(0, 0, 0, 500, 30000).toBrep(true, true);
  brace.transform(rhino.Transform.rotation(Math.PI / 6, [0, 1, 0], [0, 0, 0]));
  brace.transform(rhino.Transform.translationXYZ(30000, 20000, -15000));
  add(brace, 'Brace', bracing.index);
  add(cylinder(-10000, -10000, -5000, 1000, 10000).toBrep(false, false), 'Tube', open.index);

  const deck = rhino.Brep.createFromBoundingBox(new rhino.BoundingBox([0, 0, 16000], [20000, 10000, 18000]));
  const faces = deck.faces();
  for (let i = 0; i < faces.count; i++) {
    // a coarse but valid render mesh per face: two triangles over the face's corner points
    const f = faces.get(i);
    const [u0, u1] = f.domain(0);
    const [v0, v1] = f.domain(1);
    const m = new rhino.Mesh();
    for (const [u, v] of [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]) m.vertices().add(...f.pointAt(u, v));
    m.faces().addQuadFace(0, 1, 2, 3);
    f.setMesh(m, rhino.MeshType.Render);
  }
  add(deck, 'Deck', topside.index);

  const tet = new rhino.Mesh();
  for (const p of [[0, 0, 0], [1000, 0, 0], [0, 1000, 0], [0, 0, 1000]]) tet.vertices().add(...p);
  for (const f of [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]]) tet.faces().addTriFace(...f);
  add(tet, 'Hull mesh', topside.index);

  add(new rhino.LineCurve([0, 0, 0], [60000, 0, 0]), 'Centreline', notes.index);
  add(cylinder(-30000, 0, -5000, 1000, 10000).toBrep(true, true), 'Hidden column', hidden.index);

  return doc.toByteArray();
}

/** A file with a single capped vertical cylinder, in the given units. */
export async function singleColumn({ units = 'Meters', diameter = 6, zBottom = -20, zTop = 15, x = 0, y = 0 } = {}) {
  const rhino = await loadRhino();
  const doc = new rhino.File3dm();
  doc.settings().modelUnitSystem = rhino.UnitSystem[units];
  const c = new rhino.Cylinder(new rhino.Circle([x, y, zBottom], diameter / 2), zTop - zBottom);
  const a = new rhino.ObjectAttributes();
  a.name = 'Column';
  doc.objects().add(c.toBrep(true, true), a);
  return doc.toByteArray();
}
