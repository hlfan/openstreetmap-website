//= require maplibre/map
//= require maplibre/geometry
//= require maplibre/data_layer
//= require maplibre/attribution
//= require maplibre/i18n
//= require @americana/diplomat/dist/index
//= require download_util

// Layer ids produced by addGeoJSONLayer all start with this prefix so the
// system test's `osm-data-*` layer check continues to match.
const HIGHLIGHT_SOURCE_ID = "osm-data-highlight";

// Event-only stand-in for overlays whose rendering lives in index/layers/*.
OSM.MapLibre.OverlayLayer = class extends maplibregl.Evented {
  constructor(code) {
    super();
    this.options = { code };
    this._map = null;
  }
};

OSM.MapLibre.MainMap = class extends OSM.MapLibre.Map {
  constructor({ container, ...options } = {}) {
    const baseLayers = OSM.LAYER_DEFINITIONS.map(
      ({ credit, nameId, style, styleDark, ...layerOptions }) => {
        if (nameId) layerOptions.name = OSM.i18n.t(`javascripts.map.base.${nameId}`);
        layerOptions.style = style;
        layerOptions.styleDark = styleDark;
        layerOptions.credit = credit;
        return layerOptions;
      }
    );

    const defaultLayer = baseLayers[0];
    const initialStyle = OSM.MapLibre.styleForLayer(defaultLayer);

    super({
      container,
      style: initialStyle,
      allowRotation: false,
      maxPitch: 0,
      zoomSnap: 1.0,
      ...options
    });

    this.baseLayers = baseLayers;
    this._currentBaseLayer = defaultLayer;
    this._layers = new Set();
    this._object = null;
    this._objectLoader = null;
    this._objectMarkers = [];
    this._objectSourceIds = [];
    this._objectSourceBounds = new Map();
    this._objectLayerIds = new Map();
    this._overlayRestorers = new Map();

    this.noteLayer = new OSM.MapLibre.OverlayLayer("N");
    this.dataLayer = new OSM.MapLibre.DataLayer({ code: "D" });
    this.gpsLayer = new OSM.MapLibre.OverlayLayer("G");

    const attrCredit = this._currentBaseLayer.credit;
    this._attributionControl = new OSM.MapLibre.AttributionControl({
      includeReportLink: true,
      credit: attrCredit
    });
    this.addControl(this._attributionControl);

    this._applyBaseLayerMaxZoom();

    this.on("style.load", () => {
      for (const [, restorer] of this._overlayRestorers) {
        restorer();
      }
    });

    OSM.MapLibre.localizeMap(this, this._currentBaseLayer);
  }

  updateLayers(layerParam) {
    const oldLayer = this._currentBaseLayer;
    let newLayer;

    for (const layer of this.baseLayers) {
      if (!newLayer || layerParam.includes(layer.code)) {
        newLayer = layer;
      }
    }

    if (newLayer && newLayer !== oldLayer) {
      this._switchBaseLayer(newLayer);
    }
  }

  _switchBaseLayer(layer) {
    this._currentBaseLayer = layer;
    const style = OSM.MapLibre.styleForLayer(layer);

    this._attributionControl._credit = layer.credit;

    this.setStyle(style, { diff: false });

    this._applyBaseLayerMaxZoom();

    OSM.MapLibre.localizeMap(this, layer);

    this.fire("baselayerchange", { layer });
  }

  _applyBaseLayerMaxZoom() {
    if (this._currentBaseLayer.maxZoom) {
      this.setMaxZoom(this._currentBaseLayer.maxZoom);
    }
  }

  getLayersCode() {
    let code = this._currentBaseLayer.code || "";
    if (this.hasLayer(this.noteLayer)) code += this.noteLayer.options.code;
    if (this.hasLayer(this.dataLayer)) code += this.dataLayer.options.code;
    if (this.hasLayer(this.gpsLayer)) code += this.gpsLayer.options.code;
    return code;
  }

  getMapBaseLayerId() {
    return this._currentBaseLayer?.layerId;
  }

  getMapBaseLayer() {
    return this._currentBaseLayer;
  }

  hasLayer(layer) {
    return this._layers.has(layer);
  }

  addLayer(layer) {
    if (layer && typeof layer === "object" &&
        "id" in layer && "type" in layer && "source" in layer) {
      return super.addLayer(layer);
    }

    if (this._layers.has(layer)) return this;
    this._layers.add(layer);

    if (layer === this.gpsLayer) {
      this._addGpsSource();
      layer._map = this;
      layer.fire("add");
      this.fire("overlayadd", { layer });
    } else if (layer === this.noteLayer) {
      layer._map = this;
      layer.fire("add"); // notes.js listens and fires "overlayadd"
    } else if (layer === this.dataLayer) {
      layer.onAdd(this); // DataLayer manages _map and fires "add"
    } else if (layer instanceof maplibregl.Marker) {
      if (!layer._map) layer.addTo(this);
    } else if (typeof layer.addTo === "function") {
      layer.addTo(this);
    }

    return this;
  }

  removeLayer(layer) {
    if (typeof layer === "string") {
      return super.removeLayer(layer);
    }

    if (!this._layers.has(layer)) return this;
    this._layers.delete(layer);

    if (layer === this.gpsLayer) {
      this._removeGpsSource();
      layer.fire("remove");
      layer._map = null;
      this.fire("overlayremove", { layer });
    } else if (layer === this.noteLayer) {
      layer.fire("remove"); // notes.js listens and fires "overlayremove"
      layer._map = null;
    } else if (layer === this.dataLayer) {
      layer.onRemove();
    } else if (layer instanceof maplibregl.Marker) {
      layer.remove();
    } else if (typeof layer.remove === "function") {
      layer.remove();
    }

    return this;
  }

  _addGpsSource() {
    const addGps = () => {
      if (!this.getSource("gps")) {
        this.addSource("gps", {
          type: "raster",
          tiles: ["https://gps.tile.openstreetmap.org/lines/{z}/{x}/{y}.png"],
          tileSize: 256,
          maxzoom: 20
        });
      }
      if (!this.getLayer("gps")) {
        super.addLayer({ id: "gps", type: "raster", source: "gps" });
      }
    };

    this._overlayRestorers.set("gps", addGps);

    if (this.isStyleLoaded()) {
      addGps();
    }
  }

  _removeGpsSource() {
    this._overlayRestorers.delete("gps");
    if (this.getLayer("gps")) super.removeLayer("gps");
    if (this.getSource("gps")) this.removeSource("gps");
  }

  // setView takes OSM (tile-Z) zoom. Defaults to jumpTo so subscribers that
  // read post-move state (e.g. note/query zoom-threshold handlers) don't see
  // stale values during a flyTo animation window.
  setView(center, zoom, options = {}) {
    const mapLibreZoom = zoom - OSM.ZOOM_OFFSET;
    if (options.animate === true) {
      this.flyTo({ center, zoom: mapLibreZoom });
    } else {
      this.jumpTo({ center, zoom: mapLibreZoom });
    }
    return this;
  }

  // MapLibre's native fitBounds produces NaN/Infinity zoom for zero-area
  // bounds, so we fall through to jumpTo in that case, matching Leaflet.
  fitBounds(bounds, options, eventData) {
    const b = maplibregl.LngLatBounds.convert(bounds);
    if (!b.isEmpty() && OSM.MapLibre.boundsSize(b) === 0) {
      this.jumpTo({ center: b.getCenter() });
      return this;
    }
    return super.fitBounds(b, options, eventData);
  }

  panInside(latlng, options = {}) {
    const padding = options.padding || [0, 0];
    const point = this.project(latlng);
    const container = this.getContainer();
    const width = container.offsetWidth;
    const height = container.offsetHeight;

    if (point.x < padding[0] || point.x > width - padding[0] ||
        point.y < padding[1] || point.y > height - padding[1]) {
      this.panTo(latlng);
    }
    return this;
  }

  getSize() {
    const container = this.getContainer();
    return { x: container.offsetWidth, y: container.offsetHeight };
  }

  addObject(object, callback) {
    class ElementGoneError extends Error {
      constructor(message = "Element is gone") {
        super(message);
        this.name = "ElementGoneError";
      }
    }

    const palette = OSM.MapLibre.DATA_LAYER_STYLE;

    const highlightStyle = {
      color: palette.hoverColor,
      weight: 4,
      opacity: 1,
      fillOpacity: 0.35
    };

    const changesetStyle = {
      weight: 4,
      color: palette.changesetColor,
      opacity: 1,
      fillOpacity: 0
    };

    const haloStyle = {
      weight: 2.5,
      radius: 20,
      fillOpacity: 0.5,
      color: palette.color
    };

    this.removeObject();

    if (object.type === "note" || object.type === "changeset") {
      this._objectLoader = { abort: () => {} };
      this._object = object;

      if (object.type === "note") {
        const haloId = "object-halo";
        const haloGeoJSON = {
          type: "Feature",
          geometry: { type: "Point", coordinates: [object.latLng.lng, object.latLng.lat] }
        };
        this._addObjectSource(haloId, haloGeoJSON, haloStyle);

        if (object.icon) {
          const marker = new OSM.MapLibre.Marker({ icon: object.icon.icon, color: object.icon.color })
            .setLngLat(object.latLng)
            .addTo(this);
          this._objectMarkers.push(marker);
        }
      } else if (object.type === "changeset") {
        if (object.bbox) {
          const bounds = new maplibregl.LngLatBounds(
            [object.bbox.minlon, object.bbox.minlat],
            [object.bbox.maxlon, object.bbox.maxlat]
          );
          const rectGeoJSON = OSM.MapLibre.rectangleGeoJSON(bounds);
          this._addObjectSource("object-changeset", rectGeoJSON, changesetStyle);
        }
      }

      const bounds = this._getObjectBounds();
      if (callback) callback(bounds);
      this.fire("overlayadd", { layer: this._object });
    } else {
      const map = this;
      this._objectLoader = new AbortController();
      fetch(OSM.apiUrl(object), {
        headers: { accept: "application/json", ...OSM.oauth },
        signal: this._objectLoader.signal
      })
        .then(async response => {
          if (response.ok) return response.json();
          if (response.status === 410) throw new ElementGoneError();
          const status = response.statusText || response.status;
          if (response.status !== 400 && response.status !== 509) throw new Error(status);
          const text = await response.text();
          throw new Error(text || status);
        })
        .then(function (data) {
          const visibleData = {
            ...data,
            elements: data.elements?.filter(el => el.visible !== false) ?? []
          };

          // nodeFilter restricts emitted point features to members of the
          // selected element — plain way nodes are not drawn for a way view,
          // but a relation's node members are drawn for a relation view.
          const fc = OSM.MapLibre.osmJsonToGeoJSON(visibleData, {
            nodeFilter: (node, ctx) => {
              if (object.type === "node") return node.id === Number(object.id);
              if (object.type === "way") return false;
              if (object.type === "relation") return ctx.relationNodeIds.has(node.id);
              return false;
            }
          });

          map._object = object;
          map._addObjectSource(HIGHLIGHT_SOURCE_ID, fc, highlightStyle);

          if (callback) callback(OSM.MapLibre.getGeoJSONBounds(fc));
          map.fire("overlayadd", { layer: map._object });
          $("#browse_status").empty();
        })
        .catch(function (error) {
          if (error.name === "AbortError") return;
          if (error instanceof ElementGoneError) {
            $("#browse_status").empty();
            return;
          }
          OSM.displayLoadError(error?.message, () => {
            $("#browse_status").empty();
          });
        });
    }
  }

  _addObjectSource(id, geojson, style) {
    if (!this._objectSourceIds.includes(id)) {
      this._objectSourceIds.push(id);
    }
    this._objectSourceBounds.set(id, OSM.MapLibre.getGeoJSONBounds(geojson));
    const restorer = () => {
      OSM.MapLibre.addGeoJSONLayer(this, id, geojson, style);
      const layerIds = this.getStyle().layers
        .filter(l => l.source === id)
        .map(l => l.id);
      this._objectLayerIds.set(id, layerIds);
    };
    this._overlayRestorers.set("object-" + id, restorer);
    if (this.isStyleLoaded()) restorer();
  }

  _getObjectBounds() {
    const bounds = new maplibregl.LngLatBounds();
    for (const id of this._objectSourceIds) {
      bounds.extend(this._objectSourceBounds.get(id));
    }
    for (const marker of this._objectMarkers) {
      bounds.extend(marker.getLngLat());
    }
    return bounds;
  }

  removeObject() {
    const previousObject = this._object;
    const hadContent = previousObject || this._objectMarkers.length || this._objectSourceIds.length;
    this._object = null;
    if (this._objectLoader) this._objectLoader.abort();
    for (const marker of this._objectMarkers) {
      marker.remove();
    }
    this._objectMarkers = [];
    for (const id of this._objectSourceIds) {
      this._overlayRestorers.delete("object-" + id);
      this._objectSourceBounds.delete(id);
      this._objectLayerIds.delete(id);
      OSM.MapLibre.removeGeoJSONLayer(this, id);
    }
    this._objectSourceIds = [];
    if (hadContent) {
      this.fire("overlayremove", { layer: previousObject });
    }
  }

  // Called by index/layers/data.js after each overlay reload so a selected
  // element keeps its distinct rendering on top. Uses the layer ids
  // snapshotted at _addObjectSource time so this is O(n) in the highlight's
  // own layers, not in the full base-style layer list (150–250 layers on
  // OpenMapTiles).
  bringElementHighlightToFront() {
    for (const layerId of this._objectLayerIds.get(HIGHLIGHT_SOURCE_ID) ?? []) {
      this.moveLayer(layerId);
    }
  }

  getState() {
    return {
      center: this.getCenter().wrap(),
      zoom: Math.round(this.getZoom() + OSM.ZOOM_OFFSET),
      layers: this.getLayersCode()
    };
  }

  setState(state, options) {
    // state.zoom is OSM convention; setView handles the conversion.
    if (state.center) this.setView(state.center, state.zoom, options);
    if (state.layers) this.updateLayers(state.layers);
  }

  setSidebarOverlaid(overlaid) {
    const mediumDeviceWidth = window.getComputedStyle(document.documentElement).getPropertyValue("--bs-breakpoint-md");
    const isMediumDevice = window.matchMedia(`(max-width: ${mediumDeviceWidth})`).matches;
    const sidebarWidth = $("#sidebar").width();
    const sidebarHeight = $("#sidebar").height();
    if (overlaid && !$("#content").hasClass("overlay-sidebar")) {
      $("#content").addClass("overlay-sidebar");
      this.resize();
      if (isMediumDevice) {
        this.panBy([0, -sidebarHeight]);
      } else if ($("html").attr("dir") !== "rtl") {
        this.panBy([-sidebarWidth, 0]);
      }
    } else if (!overlaid && $("#content").hasClass("overlay-sidebar")) {
      if (isMediumDevice) {
        this.panBy([0, $("#map").height() / 2]);
      } else if ($("html").attr("dir") !== "rtl") {
        this.panBy([sidebarWidth, 0]);
      }
      $("#content").removeClass("overlay-sidebar");
      this.resize();
    }
    return this;
  }

  getUrl(marker) {
    const params = {};

    if (marker && this.hasLayer(marker)) {
      const ll = marker.getLngLat();
      const { lat, lng } = OSM.cropLocation(ll, Math.round(this.getZoom() + OSM.ZOOM_OFFSET));
      params.mlat = lat;
      params.mlon = lng;
    }

    let url = location.protocol + "//" + OSM.SERVER_URL + "/";
    const query = new URLSearchParams(params),
          hash = OSM.formatHash(this);

    if (query.toString()) url += "?" + query;
    if (hash) url += hash;

    return url;
  }

  getShortUrl(marker) {
    const zoom = Math.round(this.getZoom() + OSM.ZOOM_OFFSET),
          latLng = marker && this.hasLayer(marker) ? marker.getLngLat().wrap() : this.getCenter().wrap(),
          char_array = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_~",
          x = Math.round((latLng.lng + 180.0) * ((1 << 30) / 90.0)),
          y = Math.round((latLng.lat + 90.0) * ((1 << 30) / 45.0)),
          c1 = interlace(x >>> 17, y >>> 17),
          c2 = interlace((x >>> 2) & 0x7fff, (y >>> 2) & 0x7fff);
    let str = location.protocol + "//" + location.hostname.replace(/^www\.openstreetmap\.org/i, "osm.org") + "/go/";

    for (let i = 0; i < Math.ceil((zoom + 8) / 3.0) && i < 5; ++i) {
      const digit = (c1 >> (24 - (6 * i))) & 0x3f;
      str += char_array.charAt(digit);
    }
    for (let i = 5; i < Math.ceil((zoom + 8) / 3.0); ++i) {
      const digit = (c2 >> (24 - (6 * (i - 5)))) & 0x3f;
      str += char_array.charAt(digit);
    }
    for (let i = 0; i < ((zoom + 8) % 3); ++i) str += "-";

    function interlace(x, y) {
      let interlaced_x = x,
          interlaced_y = y;
      interlaced_x = (interlaced_x | (interlaced_x << 8)) & 0x00ff00ff;
      interlaced_x = (interlaced_x | (interlaced_x << 4)) & 0x0f0f0f0f;
      interlaced_x = (interlaced_x | (interlaced_x << 2)) & 0x33333333;
      interlaced_x = (interlaced_x | (interlaced_x << 1)) & 0x55555555;
      interlaced_y = (interlaced_y | (interlaced_y << 8)) & 0x00ff00ff;
      interlaced_y = (interlaced_y | (interlaced_y << 4)) & 0x0f0f0f0f;
      interlaced_y = (interlaced_y | (interlaced_y << 2)) & 0x33333333;
      interlaced_y = (interlaced_y | (interlaced_y << 1)) & 0x55555555;
      return (interlaced_x << 1) | interlaced_y;
    }

    const params = new URLSearchParams();
    const layers = this.getLayersCode().replace("M", "");

    if (layers) params.set("layers", layers);
    if (marker && this.hasLayer(marker)) params.set("m", "");
    if (this._object) params.set(this._object.type, this._object.id);

    const query = params.toString();
    if (query) str += "?" + query;

    return str;
  }

  getGeoUri(marker) {
    let latLng = this.getCenter();
    const zoom = Math.round(this.getZoom() + OSM.ZOOM_OFFSET);

    if (marker && this.hasLayer(marker)) {
      latLng = marker.getLngLat();
    }

    const { lat, lng } = OSM.cropLocation(latLng, zoom);
    return `geo:${lat},${lng}?z=${zoom}`;
  }
};

OSM.getMarker = function ({ icon = "dot", color = "var(--marker-red)", ...options }) {
  return { icon, color, ...options };
};

OSM.noteMarkers = {
  "closed": OSM.getMarker({ icon: "tick", color: "var(--marker-green)" }),
  "new": OSM.getMarker({ icon: "plus", color: "var(--marker-blue)" }),
  "open": OSM.getMarker({ icon: "cross", color: "var(--marker-red)" })
};
