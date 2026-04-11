OSM.MapLibre.LocationFilter = class extends maplibregl.Evented {
  constructor() {
    super();
    this._enabled = false;
    this._map = null;
    this._sw = null;
    this._ne = null;
    this._handles = {};
    this._sourceId = "location-filter";
    this._draggingMarker = null;
  }

  addTo(map) {
    this._map = map;
    return this;
  }

  remove() {
    this.disable();
    this._map = null;
  }

  getBounds() {
    if (!this._sw || !this._ne) return this._map?.getBounds();
    return new maplibregl.LngLatBounds(
      [this._sw.lng, this._sw.lat],
      [this._ne.lng, this._ne.lat]
    );
  }

  setBounds(bounds) {
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    this._sw = { lat: sw.lat, lng: sw.lng };
    this._ne = { lat: ne.lat, lng: ne.lng };
    if (this._enabled) {
      this._drawFilter();
      this.fire("change", { bounds: this.getBounds() });
    }
  }

  isEnabled() {
    return this._enabled;
  }

  enable() {
    if (this._enabled) return;
    if (!this._map) return;

    if (!this._sw || !this._ne) {
      const bounds = this._map.getBounds();
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      this._sw = { lat: sw.lat, lng: sw.lng };
      this._ne = { lat: ne.lat, lng: ne.lng };
    }

    this._enabled = true;
    // _drawFilter internally waits for the style to be ready (via
    // whenStyleReady), so opening /export before the first style.load
    // still draws the filter once the style finishes loading.
    this._drawFilter();
    this._createMarkers();

    this.fire("enabled");
  }

  disable() {
    if (!this._enabled) return;

    this._removeMarkers();
    this._removeLayers();

    this._enabled = false;
    this.fire("disabled");
  }

  // Build the mask GeoJSON — filter box cut out of a full-world polygon.
  // Using a fixed world-wide outer ring avoids the degeneracies that an
  // expanded viewport polygon produces near the poles or across the
  // antimeridian, and means the mask never needs to be redrawn on map move.
  _buildMaskGeoJSON() {
    const outer = [
      [-180, -90],
      [180, -90],
      [180, 90],
      [-180, 90],
      [-180, -90]
    ];
    const inner = [
      [this._sw.lng, this._sw.lat],
      [this._ne.lng, this._sw.lat],
      [this._ne.lng, this._ne.lat],
      [this._sw.lng, this._ne.lat],
      [this._sw.lng, this._sw.lat]
    ];
    return { type: "Feature", geometry: { type: "Polygon", coordinates: [outer, inner] } };
  }

  _cornerLngLat(corner) {
    const sw = this._sw,
          ne = this._ne;
    switch (corner) {
      case "nw": return [sw.lng, ne.lat];
      case "ne": return [ne.lng, ne.lat];
      case "sw": return [sw.lng, sw.lat];
      case "se": return [ne.lng, sw.lat];
      case "move": return [sw.lng, ne.lat];
    }
  }

  // Create the source+layer on first draw, then just re-feed data on updates.
  _upsertSourceLayer(suffix, data, type, paint) {
    const id = this._sourceId + suffix;
    const source = this._map.getSource(id);
    if (source) {
      source.setData(data);
    } else {
      this._map.addSource(id, { type: "geojson", data });
      this._map.addLayer({ id, type, source: id, paint });
    }
  }

  _drawFilter() {
    if (!this._map) return;
    OSM.MapLibre.whenStyleReady(this._map, () => {
      if (!this._map || !this._enabled) return;

      this._upsertSourceLayer("-mask", this._buildMaskGeoJSON(), "fill",
                              { "fill-color": "black", "fill-opacity": 0.3 });

      const borderRing = ["sw", "se", "ne", "nw", "sw"].map(c => this._cornerLngLat(c));
      this._upsertSourceLayer("-border", {
        type: "Feature",
        geometry: { type: "LineString", coordinates: borderRing }
      }, "line", { "line-color": "white", "line-width": 1, "line-opacity": 0.9 });

      // Update marker positions. Skip whichever marker is currently being
      // dragged so we don't fight MapLibre's pointer tracking mid-drag.
      for (const [corner, marker] of Object.entries(this._handles)) {
        if (this._draggingMarker !== marker) marker.setLngLat(this._cornerLngLat(corner));
      }
    });
  }

  _createMarkers() {
    const makeHandle = (className, height, cursor) => {
      const el = document.createElement("div");
      el.className = "location-filter " + className;
      el.style.width = "13px";
      el.style.height = height;
      el.style.cursor = cursor;
      return el;
    };

    for (const corner of ["nw", "ne", "sw", "se"]) {
      const marker = new maplibregl.Marker({ element: makeHandle("resize-marker", "12px", "pointer"), draggable: true })
        .setLngLat(this._cornerLngLat(corner)).addTo(this._map);
      this._handles[corner] = marker;
      this._setupResize(marker, corner);
    }

    const moveMarker = new maplibregl.Marker({ element: makeHandle("move-marker", "13px", "move"), draggable: true, offset: [-10, -10] })
      .setLngLat(this._cornerLngLat("move")).addTo(this._map);
    this._handles.move = moveMarker;

    moveMarker.on("dragstart", () => {
      this._draggingMarker = moveMarker;
    });
    moveMarker.on("drag", () => {
      const pos = moveMarker.getLngLat();
      const latDelta = pos.lat - this._ne.lat;
      const lngDelta = pos.lng - this._sw.lng;
      this._sw = { lat: this._sw.lat + latDelta, lng: this._sw.lng + lngDelta };
      this._ne = { lat: this._ne.lat + latDelta, lng: this._ne.lng + lngDelta };
      this._drawFilter();
    });
    moveMarker.on("dragend", () => {
      this._draggingMarker = null;
      this.fire("change", { bounds: this.getBounds() });
    });
  }

  _setupResize(marker, corner) {
    marker.on("dragstart", () => {
      this._draggingMarker = marker;
    });
    marker.on("drag", () => {
      const pos = marker.getLngLat();
      if (corner === "nw") {
        this._sw.lng = pos.lng;
        this._ne.lat = pos.lat;
      } else if (corner === "ne") {
        this._ne.lng = pos.lng;
        this._ne.lat = pos.lat;
      } else if (corner === "sw") {
        this._sw.lng = pos.lng;
        this._sw.lat = pos.lat;
      } else if (corner === "se") {
        this._ne.lng = pos.lng;
        this._sw.lat = pos.lat;
      }
      this._drawFilter();
    });
    marker.on("dragend", () => {
      this._draggingMarker = null;
      const lats = [this._sw.lat, this._ne.lat].sort((a, b) => a - b);
      const lngs = [this._sw.lng, this._ne.lng].sort((a, b) => a - b);
      this._sw = { lat: lats[0], lng: lngs[0] };
      this._ne = { lat: lats[1], lng: lngs[1] };
      this._drawFilter();
      this.fire("change", { bounds: this.getBounds() });
    });
  }

  _removeMarkers() {
    for (const marker of Object.values(this._handles)) {
      marker.remove();
    }
    this._handles = {};
  }

  _removeLayers() {
    if (!this._map) return;
    const sid = this._sourceId;
    for (const suffix of ["-mask", "-border"]) {
      if (this._map.getLayer(sid + suffix)) this._map.removeLayer(sid + suffix);
      if (this._map.getSource(sid + suffix)) this._map.removeSource(sid + suffix);
    }
  }
};
