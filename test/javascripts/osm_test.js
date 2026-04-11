//= require jquery
//= require js-cookie/dist/js.cookie
//= require osm
//= require maplibre-gl/dist/maplibre-gl
//= require maplibre/map
//= require maplibre/geometry
//= require maplibre/osm_geojson
//= require maplibre/data_layer_style
//= require maplibre/data_layer
//= require maplibre/main_map

describe("OSM", function () {
  describe(".apiUrl", function () {
    it("returns a URL for a way", function () {
      expect(OSM.apiUrl({ type: "way", id: 10 })).to.eq("/api/0.6/way/10/full");
    });

    it("returns a URL for a node", function () {
      expect(OSM.apiUrl({ type: "node", id: 10 })).to.eq("/api/0.6/node/10");
    });

    it("returns a URL for a specific version", function () {
      expect(OSM.apiUrl({ type: "node", id: 10, version: 2 })).to.eq("/api/0.6/node/10/2");
    });
  });

  describe(".mapParams", function () {
    beforeEach(function () {
      delete OSM.home;
      delete OSM.location;
      location.hash = "";
      document.cookie = "_osm_location=; expires=Thu, 01 Jan 1970 00:00:00 GMT";

      // Test with another cookie set.
      document.cookie = "_osm_session=deadbeef";
    });

    it("parses marker params", function () {
      const params = OSM.mapParams("?mlat=57.6247&mlon=-3.6845");
      expect(params).to.have.property("mlat", 57.6247);
      expect(params).to.have.property("mlon", -3.6845);
      expect(params).to.have.property("marker", true);
    });

    it("parses object params", function () {
      let params = OSM.mapParams("?node=1");
      expect(params).to.have.property("object");
      expect(params.object).to.eql({ type: "node", id: 1 });

      params = OSM.mapParams("?way=1");
      expect(params).to.have.property("object");
      expect(params.object).to.eql({ type: "way", id: 1 });

      params = OSM.mapParams("?relation=1");
      expect(params).to.have.property("object");
      expect(params.object).to.eql({ type: "relation", id: 1 });
    });

    it("parses bbox params", function () {
      let params = OSM.mapParams("?bbox=-3.6845,57.6247,-3.7845,57.7247");
      expect(params).to.have.property("bounds");
      expect(params.bounds.getSouthWest().lng).to.be.closeTo(-3.6845, 0.0001);
      expect(params.bounds.getSouthWest().lat).to.be.closeTo(57.6247, 0.0001);
      expect(params.bounds.getNorthEast().lng).to.be.closeTo(-3.7845, 0.0001);
      expect(params.bounds.getNorthEast().lat).to.be.closeTo(57.7247, 0.0001);

      params = OSM.mapParams("?minlon=-3.6845&minlat=57.6247&maxlon=-3.7845&maxlat=57.7247");
      expect(params).to.have.property("bounds");
      expect(params.bounds.getSouthWest().lng).to.be.closeTo(-3.6845, 0.0001);
      expect(params.bounds.getSouthWest().lat).to.be.closeTo(57.6247, 0.0001);
      expect(params.bounds.getNorthEast().lng).to.be.closeTo(-3.7845, 0.0001);
      expect(params.bounds.getNorthEast().lat).to.be.closeTo(57.7247, 0.0001);
    });

    it("parses mlat/mlon/zoom params", function () {
      let params = OSM.mapParams("?mlat=57.6247&mlon=-3.6845");
      expect(params).to.have.property("lat", 57.6247);
      expect(params).to.have.property("lon", -3.6845);
      expect(params).to.have.property("zoom", 12);

      params = OSM.mapParams("?mlat=57.6247&mlon=-3.6845&zoom=16");
      expect(params).to.have.property("lat", 57.6247);
      expect(params).to.have.property("lon", -3.6845);
      expect(params).to.have.property("zoom", 16);
    });

    it("parses geoURIs", function () {
      const params = OSM.mapParams("?geouri=geo%3A57.6247%2C-3.6845");
      expect(params).to.have.property("lat", 57.6247);
      expect(params).to.have.property("lon", -3.6845);
      expect(params).to.have.property("mlat", 57.6247);
      expect(params).to.have.property("mlon", -3.6845);
      expect(params).to.have.property("zoom", 12);
    });

    it("parses zoom in geoURIs", function () {
      const params = OSM.mapParams("?geouri=geo%3A57.6247%2C-3.6845%3Fz%3D16");
      expect(params).to.have.property("lat", 57.6247);
      expect(params).to.have.property("lon", -3.6845);
      expect(params).to.have.property("mlat", 57.6247);
      expect(params).to.have.property("mlon", -3.6845);
      expect(params).to.have.property("zoom", 16);
    });

    it("parses uncertainty in geoURIs", function () {
      const params = OSM.mapParams("?geouri=geo%3A57.6247%2C-3.6845%3Bu%3D100");
      expect(params).to.have.property("mlat", 57.6247);
      expect(params).to.have.property("mlon", -3.6845);
      expect(params).to.have.property("mrad", 100);
      expect(params).to.have.property("bounds");
    });

    it("parses lat/lon/zoom from the hash", function () {
      location.hash = "#map=16/57.6247/-3.6845";
      const params = OSM.mapParams("?");
      expect(params).to.have.property("lat", 57.6247);
      expect(params).to.have.property("lon", -3.6845);
      expect(params).to.have.property("zoom", 16);
    });

    it("sets lat/lon from OSM.home", function () {
      OSM.home = { lat: 57.6247, lon: -3.6845 };
      const params = OSM.mapParams("?");
      expect(params).to.have.property("lat", 57.6247);
      expect(params).to.have.property("lon", -3.6845);
    });

    it("sets bbox from OSM.location", function () {
      OSM.location = { minlon: -3.7845, minlat: 57.6247, maxlon: -3.6845, maxlat: 57.7247 };
      const params = OSM.mapParams("?");
      expect(params).to.have.property("bounds");
      expect(params.bounds.getSouthWest().lng).to.be.closeTo(-3.7845, 0.0001);
      expect(params.bounds.getSouthWest().lat).to.be.closeTo(57.6247, 0.0001);
      expect(params.bounds.getNorthEast().lng).to.be.closeTo(-3.6845, 0.0001);
      expect(params.bounds.getNorthEast().lat).to.be.closeTo(57.7247, 0.0001);
    });

    it("parses params from the _osm_location cookie", function () {
      document.cookie = "_osm_location=-3.6845|57.6247|5|M";
      const params = OSM.mapParams("?");
      expect(params).to.have.property("lat", 57.6247);
      expect(params).to.have.property("lon", -3.6845);
      expect(params).to.have.property("zoom", 5);
      expect(params).to.have.property("layers", "M");
    });

    it("defaults lat/lon to London", function () {
      let params = OSM.mapParams("?");
      expect(params).to.have.property("lat", 51.5);
      expect(params).to.have.property("lon", -0.1);
      expect(params).to.have.property("zoom", 5);

      params = OSM.mapParams("?zoom=10");
      expect(params).to.have.property("lat", 51.5);
      expect(params).to.have.property("lon", -0.1);
      expect(params).to.have.property("zoom", 10);
    });

    it("parses layers param", function () {
      let params = OSM.mapParams("?");
      expect(params).to.have.property("layers", "");

      document.cookie = "_osm_location=-3.6845|57.6247|5|C";
      params = OSM.mapParams("?");
      expect(params).to.have.property("layers", "C");

      location.hash = "#map=5/57.6247/-3.6845&layers=M";
      params = OSM.mapParams("?");
      expect(params).to.have.property("layers", "M");
    });
  });

  describe(".parseGeoURI", function () {
    it("parses basic geoURIs", function () {
      let params = OSM.parseGeoURI("geo:57.6247,-3.6845");
      expect(params.coords.lat).to.equal(57.6247);
      expect(params.coords.lng).to.equal(-3.6845);
      expect(params.zoom).to.be.undefined;
      expect(params.uncertainty).to.be.undefined;
      params = OSM.parseGeoURI("GEO:57.6247,-3.6845");
      expect(params.coords.lat).to.equal(57.6247);
      expect(params.coords.lng).to.equal(-3.6845);
    });
    it("parses only geoURIs", function () {
      let params = OSM.parseGeoURI("latlng:57.6247,-3.6845");
      expect(params).to.be.undefined;
      params = OSM.parseGeoURI("geo57.6247,-3.6845");
      expect(params).to.be.undefined;
    });
    it("rejects geoURIs with less than 2 coordinates", function () {
      const params = OSM.parseGeoURI("geo:57.6247");
      expect(params).to.be.undefined;
    });
    it("parses geoURIs with altitude", function () {
      const params = OSM.parseGeoURI("geo:57.6247,-3.6845,100");
      expect(params.coords.lat).to.equal(57.6247);
      expect(params.coords.lng).to.equal(-3.6845);
      expect(params.coords.alt).to.equal(100);
    });
    it("rejects geoURIs with more than 3 coordinates", function () {
      const params = OSM.parseGeoURI("geo:123,57.6247,-3.6845,100");
      expect(params).to.be.undefined;
    });
    it("ignores non-numeric coordinates", function () {
      let params = OSM.parseGeoURI("geo:57.6247,-3.6845,abc");
      expect(params.coords.lat).to.equal(57.6247);
      expect(params.coords.lng).to.equal(-3.6845);
      expect(isNaN(params.coords.alt)).to.be.true;
      params = OSM.parseGeoURI("geo:57.6247,abc");
      expect(params).to.be.undefined;
    });
    it("parses geoURIs with crs", function () {
      let params = OSM.parseGeoURI("geo:57.6247,-3.6845;crs=wgs84");
      expect(params.coords.lat).to.equal(57.6247);
      params = OSM.parseGeoURI("geo:57.6247,-3.6845;CRS=wgs84");
      expect(params.coords.lat).to.equal(57.6247);
      params = OSM.parseGeoURI("geo:57.6247,-3.6845;CRS=WGS84");
      expect(params.coords.lat).to.equal(57.6247);
    });
    it("rejects geoURIs with different crs", function () {
      const params = OSM.parseGeoURI("geo:57.6247,-3.6845;crs=utm");
      expect(params).to.be.undefined;
    });
    it("parses geoURIs with uncertainty", function () {
      let params = OSM.parseGeoURI("geo:57.6247,-3.6845;u=100");
      expect(params.uncertainty).to.equal(100);
      params = OSM.parseGeoURI("geo:57.6247,-3.6845;U=100");
      expect(params.uncertainty).to.equal(100);
    });
    it("ignores negative uncertainty", function () {
      const params = OSM.parseGeoURI("geo:57.6247,-3.6845;u=-100");
      expect(params.uncertainty).to.be.undefined;
    });
    it("ignores non-numeric uncertainty", function () {
      const params = OSM.parseGeoURI("geo:57.6247,-3.6845;u=abc");
      expect(params.uncertainty).to.be.undefined;
    });
    it("parses uncertainty 0", function () {
      const params = OSM.parseGeoURI("geo:57.6247,-3.6845;u=0");
      expect(params.uncertainty).to.equal(0);
    });
    it("ignores uncertainty in the query parameters", function () {
      const params = OSM.parseGeoURI("geo:57.6247,-3.6845?u=100");
      expect(params.uncertainty).to.be.undefined;
    });
    it("parses geoURIs with zoom", function () {
      let params = OSM.parseGeoURI("geo:57.6247,-3.6845?z=16");
      expect(params.zoom).to.equal(16);
      params = OSM.parseGeoURI("geo:57.6247,-3.6845?Z=16");
      expect(params.zoom).to.be.undefined;
    });
    it("ignores non-numeric zoom", function () {
      const params = OSM.parseGeoURI("geo:57.6247,-3.6845?z=abc");
      expect(params.zoom).to.be.undefined;
    });
    it("ignores negative zoom", function () {
      const params = OSM.parseGeoURI("geo:57.6247,-3.6845?z=-100");
      expect(params.zoom).to.be.undefined;
    });
    it("parses geoURIs with zoom level 0", function () {
      const params = OSM.parseGeoURI("geo:57.6247,-3.6845?z=0");
      expect(params.zoom).to.equal(0);
    });
    it("ignores zoom in the geouri parameters", function () {
      const params = OSM.parseGeoURI("geo:57.6247,-3.6845;z=16");
      expect(params.zoom).to.be.undefined;
    });
  });

  describe(".parseHash", function () {
    it("parses lat/lon/zoom params", function () {
      const args = OSM.parseHash("#map=5/57.6247/-3.6845&layers=M");
      expect(args).to.have.property("center");
      expect(args.center.lat).to.equal(57.6247);
      expect(args.center.lng).to.equal(-3.6845);
      expect(args).to.have.property("zoom", 5);
    });

    it("parses layers params", function () {
      const args = OSM.parseHash("#map=5/57.6247/-3.6845&layers=M");
      expect(args).to.have.property("layers", "M");
    });
  });

  describe(".formatHash", function () {
    it("formats lat/lon/zoom params", function () {
      const args = { center: { lat: 57.6247, lng: -3.6845 }, zoom: 9 };
      expect(OSM.formatHash(args)).to.eq("#map=9/57.625/-3.685");
    });

    it("respects zoomPrecision", function () {
      let args = { center: { lat: 57.6247, lng: -3.6845 }, zoom: 5 };
      expect(OSM.formatHash(args)).to.eq("#map=5/57.62/-3.68");

      args = { center: { lat: 57.6247, lng: -3.6845 }, zoom: 9 };
      expect(OSM.formatHash(args)).to.eq("#map=9/57.625/-3.685");

      args = { center: { lat: 57.6247, lng: -3.6845 }, zoom: 12 };
      expect(OSM.formatHash(args)).to.eq("#map=12/57.6247/-3.6845");
    });

    it("formats layers params", function () {
      const args = { center: { lat: 57.6247, lng: -3.6845 }, zoom: 9, layers: "C" };
      expect(OSM.formatHash(args)).to.eq("#map=9/57.625/-3.685&layers=C");
    });

    it("ignores default layers", function () {
      const args = { center: { lat: 57.6247, lng: -3.6845 }, zoom: 9, layers: "M" };
      expect(OSM.formatHash(args)).to.eq("#map=9/57.625/-3.685");
    });

    it("formats from a map object, applying ZOOM_OFFSET", function () {
      // Stub the map-like object that the getCenter/getZoom/getLayersCode
      // branch expects. getZoom() returns the MapLibre internal zoom; the
      // emitted hash should be at OSM zoom (MapLibre zoom + ZOOM_OFFSET).
      const stubMap = {
        getCenter: () => ({ lat: 57.6247, lng: -3.6845 }),
        getZoom: () => 9 - OSM.ZOOM_OFFSET,
        getLayersCode: () => "C"
      };
      expect(OSM.formatHash(stubMap)).to.eq("#map=9/57.625/-3.685&layers=C");
    });
  });

  describe(".locationCookie", function () {
    it("creates a location cookie string", function () {
      // Cookie format is lng|lat|zoom|layers where zoom is OSM zoom (i.e.
      // MapLibre internal zoom + ZOOM_OFFSET). Round-trip this through a
      // stub map rather than constructing a real map instance.
      const stubMap = {
        getCenter: () => ({ lat: 57.6247, lng: -3.6845 }),
        getZoom: () => 9 - OSM.ZOOM_OFFSET,
        getLayersCode: () => "M"
      };
      expect(OSM.locationCookie(stubMap)).to.eq("-3.685|57.625|9|M");
    });

    it("honours zoom precision", function () {
      const stubMap = {
        getCenter: () => ({ lat: 57.6247, lng: -3.6845 }),
        getZoom: () => 12 - OSM.ZOOM_OFFSET,
        getLayersCode: () => ""
      };
      expect(OSM.locationCookie(stubMap)).to.eq("-3.6845|57.6247|12|");
    });
  });

  describe(".zoomPrecision", function () {
    it("suggests 1 digit for z0-2", function () {
      expect(OSM.zoomPrecision(0)).to.eq(1);
      expect(OSM.zoomPrecision(1)).to.eq(1);
      expect(OSM.zoomPrecision(2)).to.eq(1);
    });

    it("suggests 2 digits for z3-6", function () {
      expect(OSM.zoomPrecision(3)).to.eq(2);
      expect(OSM.zoomPrecision(4)).to.eq(2);
      expect(OSM.zoomPrecision(5)).to.eq(2);
      expect(OSM.zoomPrecision(6)).to.eq(2);
    });

    it("suggests 3 digits for z7-9", function () {
      expect(OSM.zoomPrecision(7)).to.eq(3);
      expect(OSM.zoomPrecision(8)).to.eq(3);
      expect(OSM.zoomPrecision(9)).to.eq(3);
    });

    it("suggests 4 digits for z10-12", function () {
      expect(OSM.zoomPrecision(10)).to.eq(4);
      expect(OSM.zoomPrecision(11)).to.eq(4);
      expect(OSM.zoomPrecision(12)).to.eq(4);
    });

    it("suggests 5 digits for z13-16", function () {
      expect(OSM.zoomPrecision(13)).to.eq(5);
      expect(OSM.zoomPrecision(14)).to.eq(5);
      expect(OSM.zoomPrecision(15)).to.eq(5);
      expect(OSM.zoomPrecision(16)).to.eq(5);
    });

    it("suggests 6 digits for z17-19", function () {
      expect(OSM.zoomPrecision(17)).to.eq(6);
      expect(OSM.zoomPrecision(18)).to.eq(6);
      expect(OSM.zoomPrecision(19)).to.eq(6);
    });

    it("suggests 7 digits for z20", function () {
      expect(OSM.zoomPrecision(20)).to.eq(7);
    });
  });
});

describe("OSM.MapLibre.osmJsonToGeoJSON", function () {
  const emit = OSM.MapLibre.osmJsonToGeoJSON;

  it("emits a point feature for a single tagged node", function () {
    const fc = emit({
      elements: [
        { type: "node", id: 1, lat: 10, lon: 20, tags: { amenity: "cafe" } }
      ]
    });
    expect(fc.type).to.eq("FeatureCollection");
    expect(fc.features).to.have.lengthOf(1);
    const f = fc.features[0];
    expect(f.geometry.type).to.eq("Point");
    expect(f.geometry.coordinates).to.eql([20, 10]);
    expect(f.properties.featureKind).to.eq("point");
    expect(f.properties.osmType).to.eq("node");
    expect(f.properties.osmId).to.eq(1);
    expect(f.properties.fid).to.eq("n1");
    expect(f.osm.tags).to.eql({ amenity: "cafe" });
    expect(f.id).to.eq("n1");
  });

  it("defaults to an empty tags object on the osm foreign member for untagged elements", function () {
    const fc = emit({
      elements: [
        { type: "node", id: 1, lat: 10, lon: 20, tags: { highway: "traffic_signals" } },
        { type: "node", id: 2, lat: 11, lon: 21 },
        { type: "way", id: 100, nodes: [1, 2] }
      ]
    });
    const byType = Object.fromEntries(fc.features.map(f => [f.properties.osmType, f]));
    expect(byType.node.osm.tags).to.eql({ highway: "traffic_signals" });
    expect(byType.way.osm.tags).to.eql({});
  });

  it("keeps tags out of rendering-facing properties so MapLibre only sees primitives", function () {
    const fc = emit({
      elements: [
        { type: "node", id: 1, lat: 10, lon: 20, tags: { amenity: "cafe" } }
      ]
    });
    for (const f of fc.features) {
      expect(f.properties).to.not.have.property("tags");
      for (const value of Object.values(f.properties)) {
        const t = typeof value;
        expect(t === "string" || t === "number" || t === "boolean" || value === null).to.be.true;
      }
    }
  });

  it("emits a line string for a way and drops its interior nodes", function () {
    const fc = emit({
      elements: [
        { type: "node", id: 1, lat: 10, lon: 20 },
        { type: "node", id: 2, lat: 11, lon: 21 },
        { type: "node", id: 3, lat: 12, lon: 22 },
        { type: "way", id: 100, nodes: [1, 2, 3], tags: { highway: "primary" } }
      ]
    });
    expect(fc.features).to.have.lengthOf(1);
    const f = fc.features[0];
    expect(f.geometry.type).to.eq("LineString");
    expect(f.properties.featureKind).to.eq("line");
    expect(f.properties.fid).to.eq("w100");
    expect(f.osm.tags).to.eql({ highway: "primary" });
    expect(f.geometry.coordinates).to.eql([[20, 10], [21, 11], [22, 12]]);
  });

  it("emits a polygon for a closed way with an area tag", function () {
    const fc = emit({
      elements: [
        { type: "node", id: 1, lat: 0, lon: 0 },
        { type: "node", id: 2, lat: 0, lon: 1 },
        { type: "node", id: 3, lat: 1, lon: 1 },
        { type: "node", id: 4, lat: 1, lon: 0 },
        { type: "way", id: 50, nodes: [1, 2, 3, 4, 1], tags: { building: "yes" } }
      ]
    });
    expect(fc.features).to.have.lengthOf(1);
    expect(fc.features[0].geometry.type).to.eq("Polygon");
    expect(fc.features[0].properties.featureKind).to.eq("area");
  });

  it("honours a custom isWayArea override", function () {
    const fc = emit({
      elements: [
        { type: "node", id: 1, lat: 0, lon: 0 },
        { type: "node", id: 2, lat: 0, lon: 1 },
        { type: "node", id: 3, lat: 1, lon: 1 },
        { type: "node", id: 4, lat: 1, lon: 0 },
        { type: "way", id: 50, nodes: [1, 2, 3, 4, 1], tags: { building: "yes" } }
      ]
    }, { isWayArea: () => false });
    expect(fc.features[0].geometry.type).to.eq("LineString");
    expect(fc.features[0].properties.featureKind).to.eq("line");
  });

  it("emits node-member points for a relation with a node member", function () {
    const fc = emit({
      elements: [
        { type: "node", id: 1, lat: 10, lon: 20 },
        { type: "relation", id: 9, members: [{ type: "node", ref: 1 }] }
      ]
    });
    // The node is referenced by a relation, so it is "interesting" and emitted.
    expect(fc.features).to.have.lengthOf(1);
    expect(fc.features[0].properties.osmType).to.eq("node");
    expect(fc.features[0].properties.osmId).to.eq(1);
  });

  it("drops plain untagged way nodes via the default interestingNode filter", function () {
    const fc = emit({
      elements: [
        { type: "node", id: 1, lat: 0, lon: 0 },
        { type: "node", id: 2, lat: 0, lon: 1 },
        { type: "way", id: 100, nodes: [1, 2] }
      ]
    });
    // Only the way is emitted; nodes 1/2 have no tags and are pure members.
    expect(fc.features).to.have.lengthOf(1);
    expect(fc.features[0].properties.osmType).to.eq("way");
  });

  it("keeps way nodes that carry an interesting tag", function () {
    const fc = emit({
      elements: [
        { type: "node", id: 1, lat: 0, lon: 0, tags: { highway: "traffic_signals" } },
        { type: "node", id: 2, lat: 0, lon: 1 },
        { type: "way", id: 100, nodes: [1, 2] }
      ]
    });
    const osmTypes = fc.features.map(f => f.properties.osmType).sort();
    expect(osmTypes).to.eql(["node", "way"]);
  });

  it("ignores source tags when computing interestingness", function () {
    const fc = emit({
      elements: [
        { type: "node", id: 1, lat: 0, lon: 0, tags: { source: "survey" } },
        { type: "node", id: 2, lat: 0, lon: 1 },
        { type: "way", id: 100, nodes: [1, 2] }
      ]
    });
    // Node 1 only has an uninteresting tag and is a way member → dropped.
    expect(fc.features).to.have.lengthOf(1);
    expect(fc.features[0].properties.osmType).to.eq("way");
  });

  it("emits a polygon for a single-changeset response", function () {
    const fc = emit({
      changeset: {
        id: 42,
        min_lon: -1,
        min_lat: -2,
        max_lon: 3,
        max_lat: 4
      }
    });
    expect(fc.features).to.have.lengthOf(1);
    const f = fc.features[0];
    expect(f.geometry.type).to.eq("Polygon");
    expect(f.properties.featureKind).to.eq("changeset");
    expect(f.properties.osmType).to.eq("changeset");
    expect(f.properties.osmId).to.eq(42);
    expect(f.properties.fid).to.eq("c42");
  });

  it("supports a custom nodeFilter that selects a single element", function () {
    const fc = emit({
      elements: [
        { type: "node", id: 1, lat: 0, lon: 0, tags: { foo: "bar" } },
        { type: "node", id: 2, lat: 1, lon: 1, tags: { foo: "bar" } }
      ]
    }, {
      nodeFilter: (node) => node.id === 2
    });
    expect(fc.features).to.have.lengthOf(1);
    expect(fc.features[0].properties.osmId).to.eq(2);
  });
});
