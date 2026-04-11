OSM.MapLibre.addGeoJSONLayer = function (map, id, geojson, style = {}) {
  OSM.MapLibre.removeGeoJSONLayer(map, id);

  map.addSource(id, { type: "geojson", data: geojson });

  // A FeatureCollection may mix point/line/polygon geometries (e.g. a
  // relation with both node and way members in query.js). Add one style
  // layer per geometry kind and let MapLibre's layer types filter features.
  // Callers like new_note.js expect the unsuffixed layer id, so single-kind
  // point/line inputs skip the suffix; polygons always use "-fill" since
  // they also add a "-line" outline.
  const kinds = OSM.MapLibre._collectGeometryKinds(geojson);
  const single = kinds.size === 1;
  const color = style.color || "#FF6200";
  const linePaint = {
    "line-color": color,
    "line-width": style.weight || 4,
    "line-opacity": style.opacity ?? 1
  };

  if (kinds.has("point")) {
    map.addLayer({
      id: single ? id : id + "-circle",
      type: "circle",
      source: id,
      paint: {
        "circle-radius": style.radius || 6,
        "circle-color": color,
        "circle-opacity": style.fillOpacity ?? style.opacity ?? 1,
        "circle-stroke-width": style.weight || 2,
        "circle-stroke-color": color,
        "circle-stroke-opacity": style.opacity ?? 1
      }
    });
  }
  if (kinds.has("line")) {
    map.addLayer({
      id: single ? id : id + "-line",
      type: "line",
      source: id,
      paint: linePaint,
      layout: { "line-cap": "round", "line-join": "round" }
    });
  }
  if (kinds.has("polygon")) {
    map.addLayer({
      id: id + "-fill",
      type: "fill",
      source: id,
      paint: {
        "fill-color": style.fillColor || color,
        "fill-opacity": style.fillOpacity ?? 0.5
      }
    });
    // Polygons share the "-line" suffix with the standalone line layer so a
    // mixed collection doesn't need two line layers; skip if that layer was
    // already added above.
    if (style.stroke !== false && !map.getLayer(id + "-line")) {
      map.addLayer({
        id: id + "-line",
        type: "line",
        source: id,
        paint: linePaint
      });
    }
  }
};

OSM.MapLibre.removeGeoJSONLayer = function (map, id) {
  // Suffixes must cover every layer id produced by addGeoJSONLayer: the
  // unsuffixed single-kind layer, plus the per-kind suffixes used when the
  // id must be disambiguated.
  for (const suffix of ["", "-fill", "-line", "-circle"]) {
    if (map.getLayer(id + suffix)) map.removeLayer(id + suffix);
  }
  if (map.getSource(id)) map.removeSource(id);
};

OSM.MapLibre.updateGeoJSONSource = function (map, id, geojson) {
  const source = map.getSource(id);
  if (source) source.setData(geojson);
};

OSM.MapLibre._collectGeometryKinds = function (geojson) {
  const kinds = new Set();
  const addType = type => {
    if (type === "Point" || type === "MultiPoint") kinds.add("point");
    else if (type === "LineString" || type === "MultiLineString") kinds.add("line");
    else if (type === "Polygon" || type === "MultiPolygon") kinds.add("polygon");
    return kinds.size === 3;
  };
  if (geojson.type === "FeatureCollection") {
    for (const f of geojson.features || []) {
      if (addType(f?.geometry?.type)) break;
    }
  } else if (geojson.type === "Feature") {
    addType(geojson.geometry?.type);
  } else {
    addType(geojson.type);
  }
  return kinds;
};

OSM.MapLibre.lineGeoJSON = function (coords) {
  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: coords.map(c => [c.lng, c.lat])
    }
  };
};

OSM.MapLibre.circleGeoJSON = function (center, radiusMeters, steps) {
  const numSteps = steps || 64;
  const coords = [];
  const earthRadius = 6371008.8;
  const lat = center.lat * Math.PI / 180;
  const lng = center.lng * Math.PI / 180;
  const d = radiusMeters / earthRadius;

  for (let i = 0; i <= numSteps; i++) {
    const bearing = (2 * Math.PI * i) / numSteps;
    const pLat = Math.asin((Math.sin(lat) * Math.cos(d)) + (Math.cos(lat) * Math.sin(d) * Math.cos(bearing)));
    const pLng = lng + Math.atan2(Math.sin(bearing) * Math.sin(d) * Math.cos(lat),
                                  Math.cos(d) - (Math.sin(lat) * Math.sin(pLat)));
    coords.push([(pLng * 180) / Math.PI, (pLat * 180) / Math.PI]);
  }

  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [coords] }
  };
};

OSM.MapLibre.rectangleGeoJSON = function (bounds, properties) {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  const feature = {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [[
        [sw.lng, sw.lat],
        [ne.lng, sw.lat],
        [ne.lng, ne.lat],
        [sw.lng, ne.lat],
        [sw.lng, sw.lat]
      ]]
    }
  };
  if (properties) feature.properties = properties;
  return feature;
};

OSM.MapLibre.polygonGeoJSON = function (coords) {
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [coords.map(c => [c.lng, c.lat])]
    }
  };
};

OSM.MapLibre.getGeoJSONBounds = function (geojson) {
  const bounds = new maplibregl.LngLatBounds();

  function processCoords(coords) {
    if (typeof coords[0] === "number") {
      bounds.extend(coords);
    } else {
      coords.forEach(processCoords);
    }
  }

  if (geojson.type === "FeatureCollection") {
    geojson.features.forEach(f => processCoords(f.geometry.coordinates));
  } else if (geojson.type === "Feature") {
    processCoords(geojson.geometry.coordinates);
  } else if (geojson.coordinates) {
    processCoords(geojson.coordinates);
  }

  return bounds;
};

// Longitude span measured going east from sw to ne, so bounds that wrap
// across the antimeridian (ne.lng < sw.lng) never yield a negative span.
OSM.MapLibre._boundsLngSpan = function (bounds) {
  const lngSpan = bounds.getNorthEast().lng - bounds.getSouthWest().lng;
  return lngSpan < 0 ? lngSpan + 360 : lngSpan;
};

OSM.MapLibre.boundsSize = function (bounds) {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  return (ne.lat - sw.lat) * OSM.MapLibre._boundsLngSpan(bounds);
};

// Mirrors Leaflet's LatLngBounds.contains(otherBounds) semantics, since
// MapLibre's LngLatBounds.contains only accepts points.
OSM.MapLibre.boundsContainBounds = function (outer, inner) {
  return outer.contains(inner.getSouthWest()) && outer.contains(inner.getNorthEast());
};

OSM.MapLibre.boundsToBBoxString = function (bounds) {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  return [sw.lng, sw.lat, ne.lng, ne.lat].join(",");
};

OSM.MapLibre.padBounds = function (bounds, bufferRatio) {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  const latPad = (ne.lat - sw.lat) * bufferRatio;
  const lngPad = OSM.MapLibre._boundsLngSpan(bounds) * bufferRatio;
  return new maplibregl.LngLatBounds(
    [sw.lng - lngPad, sw.lat - latPad],
    [ne.lng + lngPad, ne.lat + latPad]
  );
};

