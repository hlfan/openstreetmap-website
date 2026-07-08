//= require maplibre/geometry
//= require maplibre/osm_geojson
//= require maplibre/data_layer_style
//= require feature_label

const SOURCE_ID = "osm-data";
const LAYER_PREFIX = "osm-data-";

// Stack order matters: areas below lines below points. The casing goes
// below its line; the halo goes below its node.
const LAYER_SPECS = [
  { suffix: "area-fill", interactive: true },
  { suffix: "line-casing" },
  { suffix: "line", interactive: true },
  { suffix: "node-halo" },
  { suffix: "node", interactive: true },
  { suffix: "changeset-fill" },
  { suffix: "changeset-line" }
];
const LAYER_IDS = LAYER_SPECS.map(s => LAYER_PREFIX + s.suffix);
const INTERACTIVE_LAYER_IDS = LAYER_SPECS
  .filter(s => s.interactive)
  .map(s => LAYER_PREFIX + s.suffix);

// Hidden from the expanded tag list but still participate in featurePrefix matching.
const HIDDEN_TAG_KEYS = new Set(OSM.MapLibre.UNINTERESTING_TAGS);

// Uses jQuery text() throughout so tag values can't inject HTML.
const buildPopupContent = (element, expanded) => {
  const $root = $("<div>");

  const prefix = OSM.featurePrefix(element);
  const name = OSM.featureName(element);
  const isNamed = name !== `#${element.id}`;

  $("<div>")
    .addClass("small text-body-secondary text-uppercase fw-semibold lh-sm")
    .text(prefix)
    .appendTo($root);
  if (isNamed) {
    $("<div>")
      .addClass("fw-semibold text-break lh-sm")
      .text(name)
      .appendTo($root);
  }

  const idBits = [`${element.type} #${element.id}`];
  if (element.version) idBits.push(`v${element.version}`);
  $("<div>")
    .addClass("small text-body-secondary")
    .text(idBits.join(" · "))
    .appendTo($root);

  if (expanded) {
    const tagKeys = Object.keys(element.tags || {})
      .filter(k => !HIDDEN_TAG_KEYS.has(k))
      .sort();
    if (tagKeys.length > 0) {
      const $dl = $("<dl>")
        .addClass("small mb-0 mt-2")
        .appendTo($root);
      for (const key of tagKeys) {
        // Each key/value pair is wrapped in its own block-level div so
        // the list stays 1-per-row instead of packing into a grid.
        const $pair = $("<div>")
          .addClass("d-flex gap-2 align-items-baseline")
          .appendTo($dl);
        $("<dt>")
          .addClass("text-body-secondary fw-normal mb-0")
          .text(key)
          .appendTo($pair);
        $("<dd>")
          .addClass("mb-0 text-break")
          .text(element.tags[key])
          .appendTo($pair);
      }
    }
  }

  return $root.get(0);
};

OSM.MapLibre.DataLayer = class extends maplibregl.Evented {
  constructor(options = {}) {
    super();
    this.options = { code: null, ...options };
    this._map = null;
    this._featureCollection = { type: "FeatureCollection", features: [] };
    this._featuresByFid = new Map();
    this._hoveredFid = null;
    this._delegatedHandlers = [];
    this._pendingRender = false;
    this._popup = null;
    this._popupShowTimer = null;
    this._popupExpandTimer = null;
    this._popupPhase = "hidden"; // "hidden" | "compact" | "expanded"
    this._overlayKey = "data-layer-" + Math.random().toString(36).slice(2);
  }

  addTo(map) {
    this.onAdd(map);
    return this;
  }

  onAdd(map) {
    this._map = map;
    // Re-add on style.load (base layer switches). `_overlayRestorers` is
    // owned by MainMap; plain maplibregl.Map instances don't have it, in
    // which case the guard below makes this a no-op.
    if (map._overlayRestorers) {
      map._overlayRestorers.set(this._overlayKey, () => {
        if (this._map === map) this._render();
      });
    }
    this._render();
    this.fire("add");
  }

  remove() {
    this.onRemove();
  }

  onRemove() {
    if (this._map?._overlayRestorers) {
      this._map._overlayRestorers.delete(this._overlayKey);
    }
    this._cleanup();
    this._map = null;
    this.fire("remove");
  }

  setData(featureCollection) {
    this._featureCollection = featureCollection || { type: "FeatureCollection", features: [] };
    this._featuresByFid = new Map();
    for (const f of this._featureCollection.features) {
      this._featuresByFid.set(f.id, f);
    }
    if (!this._map) return;
    const source = this._map.getSource(SOURCE_ID);
    if (source) {
      source.setData(this._featureCollection);
    } else {
      this._render();
    }
  }

  clear() {
    this.setData({ type: "FeatureCollection", features: [] });
  }

  cancelLoading() {
    // no-op for compatibility with the layers manager
  }

  getBounds() {
    return OSM.MapLibre.getGeoJSONBounds(this._featureCollection);
  }

  _render() {
    if (!this._map) return;
    if (!this._map.isStyleLoaded()) {
      if (!this._pendingRender) {
        this._pendingRender = true;
        this._map.onceStyleReady(() => {
          this._pendingRender = false;
          if (this._map) this._render();
        });
      }
      return;
    }

    this._cleanup();

    const map = this._map;
    map.addSource(SOURCE_ID, {
      type: "geojson",
      data: this._featureCollection,
      promoteId: "fid"
    });

    const theme = OSM.isDark("map") ? "dark" : "light";
    const style = OSM.MapLibre.buildDataLayerStyle(theme);

    for (const { suffix } of LAYER_SPECS) {
      const spec = style[suffix];
      const layer = {
        id: LAYER_PREFIX + suffix,
        type: spec.type,
        source: SOURCE_ID,
        filter: spec.filter,
        paint: spec.paint
      };
      if (spec.layout) layer.layout = spec.layout;
      map.addLayer(layer);
    }

    this._wireInteractions();
  }

  _wireInteractions() {
    const map = this._map;
    const layerIds = INTERACTIVE_LAYER_IDS;

    this._popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 12,
      className: "pe-none",
      maxWidth: "320px"
    });

    // Build an OSM element shape from our own stored feature rather
    // than e.features. Tags/version/timestamp live on the Feature-level
    // `osm` foreign member (see osm_geojson.js) — they are stripped out
    // of MapLibre's rendering properties but preserved on the JS object
    // we keep a reference to here.
    const elementForFid = (fid) => {
      const stored = this._featuresByFid.get(fid);
      if (!stored) return null;
      const meta = stored.osm || {};
      return {
        type: stored.properties.osmType,
        id: stored.properties.osmId,
        tags: meta.tags || {},
        version: meta.version,
        timestamp: meta.timestamp
      };
    };

    const renderPopup = (expanded) => {
      const element = elementForFid(this._hoveredFid);
      if (!element) return;
      this._popup.setDOMContent(buildPopupContent(element, expanded)).addTo(map);
      this._popupPhase = expanded ? "expanded" : "compact";
    };

    const scheduleExpand = () => {
      clearTimeout(this._popupExpandTimer);
      this._popupExpandTimer = setTimeout(() => {
        if (this._popupPhase === "compact") renderPopup(true);
      }, 1000);
    };

    const showCompactThenExpand = () => {
      renderPopup(false);
      scheduleExpand();
    };

    const mouseMoveHandler = (e) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const fid = feature.id;
      // Keep the popup glued to the cursor on every mousemove, not only
      // when the hovered feature changes.
      this._popup.setLngLat(e.lngLat);
      if (this._hoveredFid === fid) return;
      if (this._hoveredFid !== null) {
        map.setFeatureState(
          { source: SOURCE_ID, id: this._hoveredFid },
          { hover: false }
        );
      }
      this._hoveredFid = fid;
      map.setFeatureState(
        { source: SOURCE_ID, id: fid },
        { hover: true }
      );
      map.getCanvas().style.cursor = "pointer";

      if (this._popupPhase === "expanded") {
        renderPopup(true);
      } else if (this._popupPhase === "compact") {
        // Restart the expand delay so tags only appear once the user has settled.
        renderPopup(false);
        scheduleExpand();
      } else {
        // Debounce first-show so sweeping across features doesn't flash the popup.
        clearTimeout(this._popupShowTimer);
        this._popupShowTimer = setTimeout(showCompactThenExpand, 200);
      }
    };

    const mouseLeaveLayersHandler = () => {
      clearTimeout(this._popupShowTimer);
      clearTimeout(this._popupExpandTimer);
      this._popupShowTimer = null;
      this._popupExpandTimer = null;
      if (this._popup) this._popup.remove();
      this._popupPhase = "hidden";
      if (this._hoveredFid === null) return;
      map.setFeatureState(
        { source: SOURCE_ID, id: this._hoveredFid },
        { hover: false }
      );
      this._hoveredFid = null;
      map.getCanvas().style.cursor = "";
    };

    const clickHandler = (e) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const { osmType, osmId } = feature.properties;
      this.fire("click", {
        layer: { feature: { type: osmType, id: osmId } },
        originalEvent: e.originalEvent
      });
    };

    map.on("mousemove", layerIds, mouseMoveHandler);
    map.on("mouseleave", layerIds, mouseLeaveLayersHandler);
    map.on("click", layerIds, clickHandler);
    this._delegatedHandlers.push(
      { type: "mousemove", layerIds, handler: mouseMoveHandler },
      { type: "mouseleave", layerIds, handler: mouseLeaveLayersHandler },
      { type: "click", layerIds, handler: clickHandler }
    );
  }

  _cleanup() {
    if (!this._map) return;
    const map = this._map;

    this._hoveredFid = null;

    clearTimeout(this._popupShowTimer);
    clearTimeout(this._popupExpandTimer);
    this._popupShowTimer = null;
    this._popupExpandTimer = null;
    this._popupPhase = "hidden";
    if (this._popup) {
      this._popup.remove();
      this._popup = null;
    }

    for (const { type, layerIds, handler } of this._delegatedHandlers) {
      map.off(type, layerIds, handler);
    }
    this._delegatedHandlers = [];

    for (const id of LAYER_IDS) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);

    map.getCanvas().style.cursor = "";
  }
};

