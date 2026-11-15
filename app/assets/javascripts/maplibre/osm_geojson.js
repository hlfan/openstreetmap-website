//= require maplibre/geometry

const AREA_TAGS = [
  "area", "building", "leisure", "tourism", "ruins", "historic",
  "landuse", "military", "natural", "sport"
];

OSM.MapLibre.UNINTERESTING_TAGS = [
  "source", "source_ref", "source:ref", "history", "attribution",
  "created_by", "tiger:county", "tiger:tlid", "tiger:upload_uuid"
];

const defaultIsWayArea = (way) => {
  const nodes = way.nodes || [];
  if (nodes.length < 4) return false;
  if (nodes[0] !== nodes[nodes.length - 1]) return false;
  for (const key in way.tags || {}) {
    if (AREA_TAGS.indexOf(key) >= 0) return true;
  }
  return false;
};

const defaultNodeFilter = (node, ctx) => {
  if (!ctx.wayNodeIds.has(node.id)) return true;
  if (ctx.relationNodeIds.has(node.id)) return true;
  for (const key in node.tags || {}) {
    if (OSM.MapLibre.UNINTERESTING_TAGS.indexOf(key) < 0) return true;
  }
  return false;
};

OSM.MapLibre.osmJsonToGeoJSON = function (data, opts = {}) {
  const isWayArea = opts.isWayArea || defaultIsWayArea;
  const nodeFilter = opts.nodeFilter || defaultNodeFilter;

  const features = [];
  const elements = data.elements || [];

  const nodesById = new Map();
  const ways = [];
  const wayNodeIds = new Set();
  const relationNodeIds = new Set();
  for (const el of elements) {
    if (el.type === "node") {
      nodesById.set(el.id, el);
    } else if (el.type === "way") {
      ways.push(el);
    } else if (el.type === "relation") {
      for (const member of el.members || []) {
        if (member.type === "node") relationNodeIds.add(member.ref);
      }
    }
  }

  // Accumulate wayNodeIds so the node filter can tell pure way members from standalone nodes.
  for (const way of ways) {
    const coords = [];
    for (const nid of way.nodes || []) {
      wayNodeIds.add(nid);
      const node = nodesById.get(nid);
      if (node) coords.push([node.lon, node.lat]);
    }
    if (coords.length < 2) continue;

    const fid = `w${way.id}`;
    const isArea = isWayArea(way);
    features.push({
      type: "Feature",
      id: fid,
      properties: {
        osmType: "way",
        osmId: way.id,
        featureKind: isArea ? "area" : "line",
        fid
      },
      // OSM metadata lives on a Feature-level foreign member rather
      // than in `properties`, because MapLibre's GeoJSON worker only
      // reliably handles primitive values in properties — a nested
      // `tags` object there silently breaks rendering of the whole
      // source. Foreign members are preserved in the JS feature
      // object we store in `_featuresByFid` on the DataLayer side.
      osm: {
        tags: way.tags || {},
        version: way.version,
        timestamp: way.timestamp
      },
      geometry: isArea ?
        { type: "Polygon", coordinates: [coords] } :
        { type: "LineString", coordinates: coords }
    });
  }

  const ctx = { wayNodeIds, relationNodeIds };
  for (const node of nodesById.values()) {
    if (!nodeFilter(node, ctx)) continue;
    const fid = `n${node.id}`;
    features.push({
      type: "Feature",
      id: fid,
      properties: {
        osmType: "node",
        osmId: node.id,
        featureKind: "point",
        fid
      },
      osm: {
        tags: node.tags || {},
        version: node.version,
        timestamp: node.timestamp
      },
      geometry: {
        type: "Point",
        coordinates: [node.lon, node.lat]
      }
    });
  }

  if (data.changeset && typeof data.changeset.min_lon === "number") {
    const cs = data.changeset;
    const bounds = new maplibregl.LngLatBounds(
      [cs.min_lon, cs.min_lat],
      [cs.max_lon, cs.max_lat]
    );
    const fid = `c${cs.id}`;
    const rect = OSM.MapLibre.rectangleGeoJSON(bounds, {
      osmType: "changeset",
      osmId: cs.id,
      featureKind: "changeset",
      fid
    });
    rect.id = fid;
    features.push(rect);
  }

  return { type: "FeatureCollection", features };
};
