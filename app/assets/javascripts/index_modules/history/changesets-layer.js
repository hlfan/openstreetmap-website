/* exported ChangesetsLayer */
// Color palettes mirror the .changeset-*-sidebar-viewport classes in common.scss.
// Keyed by sidebarRelativePosition: 1 = above, 0 = in view, -1 = below.
const ChangesetsLayer_OUTLINE_COLOR_EXPR = [
  "match", ["get", "sidebarPos"],
  1, "#FFF4F4",
  0, "#FFFFFF",
  -1, "#F4F4FF",
  "#FFFFFF"
];

const ChangesetsLayer_BORDER_COLOR_EXPR = [
  "match", ["get", "sidebarPos"],
  1, "#CC6655",
  0, "#FF9500",
  -1, "#8888AA",
  "#FF9500"
];

const ChangesetsLayer_FILL_COLOR_EXPR = [
  "match", ["get", "sidebarPos"],
  1, "#DDBBBB",
  0, "#FFFFAF",
  -1, "#CCCCDD",
  "#FFFFAF"
];

const ChangesetsLayer = class extends maplibregl.Evented {
  constructor() {
    super();
    this._changesets = new Map();
    this._map = null;
    this._sourceId = "history-changesets";
    this._eventHandlers = [];
    this._highlightId = null;
  }

  addTo(map) {
    this._map = map;
    // Re-add sources/layers after setStyle({diff:false}) wipes them.
    this._onStyleLoad = () => {
      this._eventHandlers = [];
      this._renderChangesets();
      if (this._highlightId !== null) {
        this.toggleChangesetHighlight(this._highlightId, true);
      }
    };
    map.on("style.load", this._onStyleLoad);
    return this;
  }

  remove() {
    if (this._map && this._onStyleLoad) {
      this._map.off("style.load", this._onStyleLoad);
      this._onStyleLoad = null;
    }
    this._cleanup();
    this._map = null;
  }

  getBounds() {
    const bounds = new maplibregl.LngLatBounds();
    for (const changeset of this._changesets.values()) {
      if (changeset.bounds) {
        bounds.extend(changeset.bounds);
      }
    }
    return bounds;
  }

  updateChangesets(map, changesets) {
    this._changesets = new Map(changesets.map(changeset => [changeset.id, changeset]));
    this.updateChangesetsGeometry(map);
  }

  updateChangesetsGeometry(map) {
    const changesetSizeLowerBound = 20;
    const mapViewExpansion = 2;

    const mapViewCenterLng = map.getCenter().lng;

    // Hoist container size reads out of the per-changeset loop: reading
    // offsetWidth/offsetHeight forces a layout flush, and with many
    // changesets that reflow-per-iteration becomes a hot path on moveend.
    const container = map.getContainer();
    const mapViewMinX = -mapViewExpansion;
    const mapViewMinY = -mapViewExpansion;
    const mapViewMaxX = container.offsetWidth + mapViewExpansion;
    const mapViewMaxY = container.offsetHeight + mapViewExpansion;

    for (const changeset of this._changesets.values()) {
      const nwLng = changeset.bbox.minlon;
      const nwLat = changeset.bbox.maxlat;
      const seLng = changeset.bbox.maxlon;
      const seLat = changeset.bbox.minlat;

      const changesetCenterLng = (nwLng + seLng) / 2;
      const shiftInWorldCircumferences = Math.round((changesetCenterLng - mapViewCenterLng) / 360);

      const adjNwLng = nwLng - (shiftInWorldCircumferences * 360);
      const adjSeLng = seLng - (shiftInWorldCircumferences * 360);

      const changesetMinCorner = map.project([adjNwLng, nwLat]);
      const changesetMaxCorner = map.project([adjSeLng, seLat]);

      let minX = changesetMinCorner.x;
      let minY = changesetMinCorner.y;
      let maxX = changesetMaxCorner.x;
      let maxY = changesetMaxCorner.y;

      const changesetSizeX = maxX - minX;
      const changesetSizeY = maxY - minY;

      if (changesetSizeX < changesetSizeLowerBound) {
        minX -= (changesetSizeLowerBound - changesetSizeX) / 2;
        maxX += (changesetSizeLowerBound - changesetSizeX) / 2;
      }

      if (changesetSizeY < changesetSizeLowerBound) {
        minY -= (changesetSizeLowerBound - changesetSizeY) / 2;
        maxY += (changesetSizeLowerBound - changesetSizeY) / 2;
      }

      const unprojMin = map.unproject([minX, minY]);
      const unprojMax = map.unproject([maxX, maxY]);

      changeset.bounds = new maplibregl.LngLatBounds(
        [Math.min(unprojMin.lng, unprojMax.lng), Math.min(unprojMin.lat, unprojMax.lat)],
        [Math.max(unprojMin.lng, unprojMax.lng), Math.max(unprojMin.lat, unprojMax.lat)]
      );

      changeset.hasEdgesInMapView = !(minX > mapViewMaxX || maxX < mapViewMinX || minY > mapViewMaxY || maxY < mapViewMinY) &&
                                     !(minX <= mapViewMinX && maxX >= mapViewMaxX && minY <= mapViewMinY && maxY >= mapViewMaxY);
    }

    this.updateChangesetsOrder();
  }

  updateChangesetsOrder() {
    if (!this._map) return;

    const changesetEntries = [...this._changesets];
    changesetEntries.sort(([, a], [, b]) => {
      const sizeA = a.bounds ? OSM.MapLibre.boundsSize(a.bounds) : 0;
      const sizeB = b.bounds ? OSM.MapLibre.boundsSize(b.bounds) : 0;
      return sizeB - sizeA;
    });
    this._changesets = new Map(changesetEntries);

    OSM.MapLibre.whenStyleReady(this._map, () => this._renderChangesets());
  }

  _renderChangesets() {
    if (!this._map) return;

    const outOfViewFeatures = [];
    const inViewFeatures = [];

    for (const changeset of this._changesets.values()) {
      if (!changeset.hasEdgesInMapView || !changeset.bounds) continue;

      const sidebarPos = changeset.sidebarRelativePosition ?? 0;
      const inView = sidebarPos === 0;
      const feature = OSM.MapLibre.rectangleGeoJSON(changeset.bounds, {
        id: changeset.id,
        inView,
        sidebarPos
      });

      if (inView) {
        inViewFeatures.push(feature);
      } else {
        outOfViewFeatures.push(feature);
      }
    }

    const allFeatures = [...outOfViewFeatures, ...inViewFeatures];
    const geojson = { type: "FeatureCollection", features: allFeatures };
    const sid = this._sourceId;

    if (this._map.getSource(sid)) {
      this._map.getSource(sid).setData(geojson);
    } else {
      this._map.addSource(sid, { type: "geojson", data: geojson });

      // Transparent fill, for click handling.
      this._map.addLayer({
        id: sid + "-area",
        type: "fill",
        source: sid,
        paint: { "fill-opacity": 0 }
      });

      // Only drawn on in-view changesets so the thicker border highlights
      // the sidebar-focused entries. Combined with the
      // size-descending sort in updateChangesetsOrder and in-view features
      // appended after out-of-view ones in _renderChangesets, smaller
      // in-view cards render above out-of-view neighbours and stay
      // clickable on top.
      this._map.addLayer({
        id: sid + "-outline",
        type: "line",
        source: sid,
        filter: ["==", ["get", "inView"], true],
        paint: {
          "line-color": ChangesetsLayer_OUTLINE_COLOR_EXPR,
          "line-width": 4,
          "line-opacity": 0.8
        }
      });

      this._map.addLayer({
        id: sid + "-border",
        type: "line",
        source: sid,
        paint: {
          "line-color": ChangesetsLayer_BORDER_COLOR_EXPR,
          "line-width": 2,
          "line-opacity": 0.6
        }
      });

      // Hit-test `this._changesets` directly rather than using layer-scoped
      // queryRenderedFeatures, so we don't race MapLibre's async GeoJSON tiling pass.
      const findChangesetAt = (lngLat) => {
        // Skip changesets without edges in view; an enclosing one isn't drawn, so it isn't clickable.
        // _changesets is largest-first, so the last match in each group is the smallest.
        let inViewMatch = null;
        let outOfViewMatch = null;
        for (const changeset of this._changesets.values()) {
          if (!changeset.hasEdgesInMapView || !changeset.bounds?.contains(lngLat)) continue;
          if ((changeset.sidebarRelativePosition ?? 0) === 0) {
            inViewMatch = changeset;
          } else {
            outOfViewMatch = changeset;
          }
        }
        return (inViewMatch ?? outOfViewMatch)?.id ?? null;
      };
      const clickHandler = (e) => {
        const id = findChangesetAt(e.lngLat);
        if (id) {
          OSM.router.click(e.originalEvent, $(`#changeset_${id} a.changeset_id`).attr("href"));
        }
      };
      const moveHandler = (e) => {
        const id = findChangesetAt(e.lngLat);
        if (id === this._highlightId) return;
        if (this._highlightId !== null) {
          this.fire("mouseout", { layer: { id: this._highlightId } });
        }
        if (id) {
          this._map.getCanvas().style.cursor = "pointer";
          this._highlightId = id;
          this.fire("mouseover", { layer: { id } });
        } else {
          this._map.getCanvas().style.cursor = "";
          this._highlightId = null;
        }
      };
      const leaveHandler = () => {
        this._map.getCanvas().style.cursor = "";
        if (this._highlightId !== null) {
          this.fire("mouseout", { layer: { id: this._highlightId } });
          this._highlightId = null;
        }
      };
      const contextHandler = (e) => {
        const id = findChangesetAt(e.lngLat);
        if (!id) return;
        e.preventDefault();
        const contextmenuItems = [{
          icon: "bi-arrow-down-up",
          text: OSM.i18n.t("javascripts.context.scroll_to_changeset"),
          callback: () => this.fire("requestscrolltochangeset", { id })
        }];
        this._map.fire("show-contextmenu", { event: { originalEvent: e.originalEvent, lngLat: e.lngLat }, items: contextmenuItems });
      };
      this._map.on("click", clickHandler);
      this._map.on("mousemove", moveHandler);
      this._map.on("mouseout", leaveHandler);
      this._map.on("contextmenu", contextHandler);
      this._eventHandlers.push(
        { type: "click", handler: clickHandler },
        { type: "mousemove", handler: moveHandler },
        { type: "mouseout", handler: leaveHandler },
        { type: "contextmenu", handler: contextHandler }
      );
    }
  }

  toggleChangesetHighlight(id, state) {
    this._highlightId = state ? id : null;

    if (!this._map) return;

    OSM.MapLibre.whenStyleReady(this._map, () => {
      if (!this._map) return;

      const sid = this._sourceId + "-highlight";

      if (state) {
        const changeset = this._changesets.get(id);
        if (!changeset?.bounds) return;

        const sidebarPos = changeset.sidebarRelativePosition ?? 0;
        const geojson = OSM.MapLibre.rectangleGeoJSON(changeset.bounds, { sidebarPos });

        if (this._map.getSource(sid)) {
          this._map.getSource(sid).setData(geojson);
        } else {
          this._map.addSource(sid, { type: "geojson", data: geojson });
          this._map.addLayer({
            id: sid + "-fill",
            type: "fill",
            source: sid,
            paint: {
              "fill-color": ChangesetsLayer_FILL_COLOR_EXPR,
              "fill-opacity": 0.3
            }
          });
          this._map.addLayer({
            id: sid + "-outline",
            type: "line",
            source: sid,
            paint: {
              "line-color": ChangesetsLayer_OUTLINE_COLOR_EXPR,
              "line-width": 8
            }
          });
          this._map.addLayer({
            id: sid + "-border",
            type: "line",
            source: sid,
            paint: {
              "line-color": ChangesetsLayer_BORDER_COLOR_EXPR,
              "line-width": 4
            }
          });
        }
      } else {
        for (const suffix of ["-fill", "-outline", "-border"]) {
          if (this._map.getLayer(sid + suffix)) this._map.removeLayer(sid + suffix);
        }
        if (this._map.getSource(sid)) this._map.removeSource(sid);
      }
    });
  }

  setChangesetSidebarRelativePosition(id, state) {
    const changeset = this._changesets.get(id);
    if (!changeset) return;
    changeset.sidebarRelativePosition = state;
  }

  _cleanup() {
    if (!this._map) return;
    for (const { type, handler } of this._eventHandlers) {
      this._map.off(type, handler);
    }
    this._eventHandlers = [];
    this._highlightId = null;

    const sid = this._sourceId;
    for (const suffix of ["-area", "-outline", "-border"]) {
      if (this._map.getLayer(sid + suffix)) this._map.removeLayer(sid + suffix);
    }
    if (this._map.getSource(sid)) this._map.removeSource(sid);

    const hsid = sid + "-highlight";
    for (const suffix of ["-fill", "-outline", "-border"]) {
      if (this._map.getLayer(hsid + suffix)) this._map.removeLayer(hsid + suffix);
    }
    if (this._map.getSource(hsid)) this._map.removeSource(hsid);
  }
};

