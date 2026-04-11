//= require maplibre/geometry

OSM.MapLibre.DataLayer = class {
  constructor(options = {}) {
    this.options = {
      areaTags: ["area", "building", "leisure", "tourism", "ruins", "historic", "landuse", "military", "natural", "sport"],
      uninterestingTags: ["source", "source_ref", "source:ref", "history", "attribution", "created_by", "tiger:county", "tiger:tlid", "tiger:upload_uuid"],
      styles: {},
      code: null,
      ...options
    };
    this._map = null;
    this._features = [];
    this._sourceIds = [];
    this._events = {};
    this._eventHandlers = [];
  }

  addTo(map) {
    this.onAdd(map);
    return this;
  }

  onAdd(map) {
    this._map = map;
    this._render();
    this.fire("add");
  }

  remove() {
    this.onRemove();
  }

  onRemove() {
    this._cleanup();
    this._map = null;
    this.fire("remove");
  }

  addData(features) {
    const list = features instanceof Array ? features : this.buildFeatures(features);
    this._features = this._features.concat(list);
    if (this._map) this._render();
  }

  clearLayers() {
    this._features = [];
    if (this._map) this._cleanup();
  }

  clear() {
    this.clearLayers();
  }

  cancelLoading() {
    // no-op for compatibility
  }

  getBounds() {
    const bounds = new maplibregl.LngLatBounds();
    for (const feature of this._features) {
      if (feature.type === "changeset" && feature.latLngBounds) {
        bounds.extend(feature.latLngBounds.getSouthWest());
        bounds.extend(feature.latLngBounds.getNorthEast());
      } else if (feature.type === "node" && feature.latLng) {
        bounds.extend([feature.latLng.lng, feature.latLng.lat]);
      } else if (feature.type === "way" && feature.nodes) {
        for (const node of feature.nodes) {
          if (node?.latLng) bounds.extend([node.latLng.lng, node.latLng.lat]);
        }
      }
    }
    return bounds;
  }

  bringToFront() {
    // Move every style layer backed by one of our sources to the top, in
    // their existing relative order. Iterating by source (rather than by
    // known id suffixes) keeps this robust to any suffix scheme chosen by
    // OSM.MapLibre.addGeoJSONLayer.
    if (!this._map) return;
    const sources = new Set(this._sourceIds);
    for (const layer of this._map.getStyle()?.layers || []) {
      if (sources.has(layer.source)) {
        this._map.moveLayer(layer.id);
      }
    }
  }

  // Feature building (parsers)

  buildFeatures(data) {
    const parser = data instanceof Document ? OSM.XMLParser : OSM.JSONParser;

    const features = parser.getChangesets(data);
    const nodes = parser.getNodes(data);
    const ways = parser.getWays(data, nodes);
    const relations = parser.getRelations(data, nodes);

    const wayNodes = {};
    for (const way of ways) {
      for (const node of way.nodes) {
        if (node) wayNodes[node.id] = true;
      }
    }

    const relationNodes = {};
    for (const relation of relations) {
      for (const member of relation.members) {
        if (member) relationNodes[member.id] = true;
      }
    }

    for (const nodeId in nodes) {
      const node = nodes[nodeId];
      if (this.interestingNode(node, wayNodes, relationNodes)) {
        features.push(node);
      }
    }

    for (const way of ways) {
      features.push(way);
    }

    return features;
  }

  isWayArea(way) {
    if (way.nodes[0] !== way.nodes[way.nodes.length - 1]) {
      return false;
    }

    for (const key in way.tags) {
      if (this.options.areaTags.indexOf(key) >= 0) {
        return true;
      }
    }

    return false;
  }

  interestingNode(node, wayNodes, relationNodes) {
    if (!wayNodes[node.id] || relationNodes[node.id]) {
      return true;
    }

    for (const key in node.tags) {
      if (this.options.uninterestingTags.indexOf(key) < 0) {
        return true;
      }
    }

    return false;
  }

  _render() {
    if (!this._map) return;
    // addSource/addLayer need the style to have finished loading. Prefer
    // to render immediately if we can; otherwise wait for style.load via
    // whenStyleReady. Track the pending flag so repeated _render calls
    // during the style-loading window coalesce into a single retry and
    // so _cleanup knows there is still a deferred render pending.
    if (!this._map.isStyleLoaded()) {
      if (!this._pendingRender) {
        this._pendingRender = true;
        OSM.MapLibre.whenStyleReady(this._map, () => {
          this._pendingRender = false;
          if (this._map) this._render();
        });
      }
      return;
    }
    this._cleanup();
    if (this._features.length === 0) return;

    const nodeFeatures = [];
    const lineFeatures = [];
    const areaFeatures = [];
    const changesetFeatures = [];

    for (const feature of this._features) {
      if (feature.type === "changeset" && feature.latLngBounds) {
        changesetFeatures.push(
          OSM.MapLibre.rectangleGeoJSON(feature.latLngBounds, { type: feature.type, id: feature.id })
        );
      } else if (feature.type === "node" && feature.latLng) {
        nodeFeatures.push({
          type: "Feature",
          properties: { type: feature.type, id: feature.id },
          geometry: {
            type: "Point",
            coordinates: [feature.latLng.lng, feature.latLng.lat]
          }
        });
      } else if (feature.type === "way" && feature.nodes) {
        const coords = feature.nodes.filter(n => n?.latLng).map(n => [n.latLng.lng, n.latLng.lat]);
        if (coords.length < 2) continue;

        if (this.isWayArea(feature)) {
          areaFeatures.push({
            type: "Feature",
            properties: { type: feature.type, id: feature.id },
            geometry: { type: "Polygon", coordinates: [coords] }
          });
        } else {
          lineFeatures.push({
            type: "Feature",
            properties: { type: feature.type, id: feature.id },
            geometry: { type: "LineString", coordinates: coords }
          });
        }
      }
    }

    const prefix = "osm-data";
    const nodeStyle = this.options.styles.node || {};
    const wayStyle = this.options.styles.way || {};
    const areaStyle = this.options.styles.area || {};
    const changesetStyle = this.options.styles.changeset || {};

    if (nodeFeatures.length) {
      const id = prefix + "-nodes";
      this._sourceIds.push(id);
      OSM.MapLibre.addGeoJSONLayer(this._map, id,
                                   { type: "FeatureCollection", features: nodeFeatures },
                                   { color: nodeStyle.color || "#FF6200", radius: 6, weight: 2, opacity: nodeStyle.opacity ?? 1, fillOpacity: nodeStyle.fillOpacity ?? 0.5 });
      this._addClickHandler(id);
    }

    if (lineFeatures.length) {
      const id = prefix + "-ways";
      this._sourceIds.push(id);
      OSM.MapLibre.addGeoJSONLayer(this._map, id,
                                   { type: "FeatureCollection", features: lineFeatures },
                                   { color: wayStyle.color || "#FF6200", weight: wayStyle.weight || 4, opacity: wayStyle.opacity ?? 1 });
      this._addClickHandler(id);
    }

    if (areaFeatures.length) {
      const id = prefix + "-areas";
      this._sourceIds.push(id);
      OSM.MapLibre.addGeoJSONLayer(this._map, id,
                                   { type: "FeatureCollection", features: areaFeatures },
                                   { color: areaStyle.color || "#FF6200", weight: areaStyle.weight || 4, opacity: areaStyle.opacity ?? 1, fillOpacity: areaStyle.fillOpacity ?? 0.5 });
      this._addClickHandler(id + "-fill");
    }

    if (changesetFeatures.length) {
      const id = prefix + "-changesets";
      this._sourceIds.push(id);
      OSM.MapLibre.addGeoJSONLayer(this._map, id,
                                   { type: "FeatureCollection", features: changesetFeatures },
                                   { color: changesetStyle.color || "#FF9500", weight: changesetStyle.weight || 4, opacity: changesetStyle.opacity ?? 1, fillOpacity: changesetStyle.fillOpacity ?? 0, stroke: changesetStyle.interactive !== false });
    }
  }

  _addClickHandler(layerId) {
    if (!this._map.getLayer(layerId)) return;
    const clickHandler = (e) => {
      const props = e.features?.[0]?.properties;
      if (props) {
        this.fire("click", {
          layer: { feature: { type: props.type, id: props.id } },
          originalEvent: e.originalEvent
        });
      }
    };
    const enterHandler = () => {
      this._map.getCanvas().style.cursor = "pointer";
    };
    const leaveHandler = () => {
      this._map.getCanvas().style.cursor = "";
    };
    this._map.on("click", layerId, clickHandler);
    this._map.on("mouseenter", layerId, enterHandler);
    this._map.on("mouseleave", layerId, leaveHandler);
    this._eventHandlers.push(
      { type: "click", layerId, handler: clickHandler },
      { type: "mouseenter", layerId, handler: enterHandler },
      { type: "mouseleave", layerId, handler: leaveHandler }
    );
  }

  _cleanup() {
    if (!this._map) return;
    for (const { type, layerId, handler } of this._eventHandlers) {
      this._map.off(type, layerId, handler);
    }
    this._eventHandlers = [];
    for (const id of this._sourceIds) {
      OSM.MapLibre.removeGeoJSONLayer(this._map, id);
    }
    this._sourceIds = [];
  }
};

Object.assign(OSM.MapLibre.DataLayer.prototype, OSM.MapLibre.Eventable);

// OSM data parsers (XML and JSON) for building map features

OSM.XMLParser = {
  getChangesets(xml) {
    const changesets = [...xml.getElementsByTagName("changeset")];
    return changesets.map(cs => ({
      id: String(cs.getAttribute("id")),
      type: "changeset",
      latLngBounds: new maplibregl.LngLatBounds(
        [parseFloat(cs.getAttribute("min_lon")), parseFloat(cs.getAttribute("min_lat"))],
        [parseFloat(cs.getAttribute("max_lon")), parseFloat(cs.getAttribute("max_lat"))]
      ),
      tags: this.getTags(cs)
    }));
  },

  getNodes(xml) {
    const result = {};
    const nodes = [...xml.getElementsByTagName("node")];
    for (const node of nodes) {
      const id = node.getAttribute("id");
      result[id] = {
        id: String(id),
        type: "node",
        latLng: { lat: parseFloat(node.getAttribute("lat")), lng: parseFloat(node.getAttribute("lon")) },
        tags: this.getTags(node)
      };
    }
    return result;
  },

  getWays(xml, nodes) {
    const ways = [...xml.getElementsByTagName("way")];
    return ways.map(way => {
      const nds = [...way.getElementsByTagName("nd")];
      return {
        id: String(way.getAttribute("id")),
        type: "way",
        nodes: nds.map(nd => nodes[nd.getAttribute("ref")]),
        tags: this.getTags(way)
      };
    });
  },

  getRelations(xml, nodes) {
    const rels = [...xml.getElementsByTagName("relation")];
    return rels.map(rel => {
      const members = [...rel.getElementsByTagName("member")];
      return {
        id: String(rel.getAttribute("id")),
        type: "relation",
        members: members
          .map(member => member.getAttribute("type") === "node" ? nodes[member.getAttribute("ref")] : null)
          .filter(Boolean),
        tags: this.getTags(rel)
      };
    });
  },

  getTags(xml) {
    const result = {};
    const tags = [...xml.getElementsByTagName("tag")];
    for (const tag of tags) {
      result[tag.getAttribute("k")] = tag.getAttribute("v");
    }
    return result;
  }
};

OSM.JSONParser = {
  getChangesets(json) {
    const changesets = json.changeset ? [json.changeset] : [];
    return changesets.map(cs => ({
      id: String(cs.id),
      type: "changeset",
      latLngBounds: new maplibregl.LngLatBounds(
        [cs.min_lon, cs.min_lat],
        [cs.max_lon, cs.max_lat]
      ),
      tags: this.getTags(cs)
    }));
  },

  getNodes(json) {
    const nodes = json.elements?.filter(el => el.type === "node") ?? [];
    const result = {};
    for (const node of nodes) {
      result[node.id] = {
        id: String(node.id),
        type: "node",
        latLng: { lat: node.lat, lng: node.lon },
        tags: this.getTags(node)
      };
    }
    return result;
  },

  getWays(json, nodes) {
    const ways = json.elements?.filter(el => el.type === "way") ?? [];
    return ways.map(way => ({
      id: String(way.id),
      type: "way",
      nodes: way.nodes.map(nodeId => nodes[nodeId]),
      tags: this.getTags(way)
    }));
  },

  getRelations(json, nodes) {
    const relations = json.elements?.filter(el => el.type === "relation") ?? [];
    return relations.map(rel => ({
      id: String(rel.id),
      type: "relation",
      members: (rel.members ?? [])
        .map(member => member.type === "node" ? nodes[member.ref] : null)
        .filter(Boolean),
      tags: this.getTags(rel)
    }));
  },

  getTags(json) {
    return json.tags ?? {};
  }
};
