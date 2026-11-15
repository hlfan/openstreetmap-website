//= require jquery
//= require js-cookie/dist/js.cookie
//= require osm
//= require maplibre-gl/dist/maplibre-gl
//= require maplibre/map
//= require maplibre/geometry
//= require maplibre/location_filter
//= require maplibre/main_map
//= require maplibre/share_control

describe("MapLibre sharing", function () {
  let map, marker, included;

  beforeEach(function () {
    map = Object.create(OSM.MapLibre.MainMap.prototype);
    map.getZoom = () => 12;
    map.getCenter = () => new maplibregl.LngLat(190.12345, 20.12345);
    map.getBounds = () => new maplibregl.LngLatBounds([181, -10], [200, 30]);
    map.getLayersCode = () => "MND";
    map.getMapBaseLayerId = () => "layer & test";
    included = true;
    map.hasLayer = candidate => candidate === marker && included;
    marker = { getLngLat: () => new maplibregl.LngLat(190.56789, 11.23456) };
  });

  it("builds long and short URL parts with wrapped marker, layers and object", function () {
    map._object = { type: "way", id: 123 };
    const long = map.getUrl(marker);
    expect(long.pathname).to.eq("/");
    expect(long.search.get("mlat")).to.eq("11.2346");
    expect(long.search.get("mlon")).to.eq("-169.4321");
    expect(long.hash).to.eq("#map=12/20.1234/-169.8766&layers=ND");

    const short = map.getShortUrl(marker);
    expect(short.pathname).to.match(/^\/go\/[A-Za-z0-9_~-]+$/);
    expect(short.search.toString()).to.eq("layers=ND&m=&way=123");
    marker.getLngLat = () => new maplibregl.LngLat(-169.43211, 11.23456);
    expect(map.getShortUrl(marker).pathname).to.eq(short.pathname);

    included = false;
    expect(map.getUrl(marker).search.toString()).to.eq("");
    expect(map.getShortUrl(marker).search.toString()).to.eq("layers=ND&way=123");
    expect(map.getShortUrl().pathname).to.eq(map.getShortUrl(marker).pathname);
    map._object = null;
    map.getLayersCode = () => "M";
    expect(map.getShortUrl().search.toString()).to.eq("");
  });

  it("uses viewport bounds and optional wrapped latitude,longitude for embeds", function () {
    let search = map.getEmbedUrl(marker).search;
    expect(search.get("bbox")).to.eq("181,-10,200,30");
    expect(search.get("layer")).to.eq("layer & test");
    const [lat, lng] = search.get("marker").split(",").map(Number);
    expect(lat).to.eq(11.23456);
    expect(lng).to.be.closeTo(-169.43211, 0.0000001);
    expect(search.toString()).to.contain("layer=layer+%26+test");
    included = false;
    search = map.getEmbedUrl(marker).search;
    expect(search.has("marker")).to.eq(false);
    expect(map.getEmbedUrl().search.has("marker")).to.eq(false);
  });

  it("uses OSM zoom rather than native MapLibre zoom in links", function () {
    const descriptor = Object.getOwnPropertyDescriptor(maplibregl.Map.prototype, "getZoom");
    try {
      Object.defineProperty(maplibregl.Map.prototype, "getZoom", {
        configurable: true,
        value: () => 11
      });
      delete map.getZoom;
      expect(map.getZoom()).to.eq(12);
      expect(map.getUrl(marker).hash).to.contain("#map=12/");
      const short = map.getShortUrl(marker).pathname;
      map.getZoom = () => 12;
      expect(map.getShortUrl(marker).pathname).to.eq(short);
      map.getZoom = () => 11;
      expect(map.getShortUrl(marker).pathname).not.to.eq(short);
    } finally {
      if (descriptor) Object.defineProperty(maplibregl.Map.prototype, "getZoom", descriptor);
      else delete maplibregl.Map.prototype.getZoom;
    }
  });

  it("honours each template URL and keeps image filter bounds out of the embed", function () {
    const original = {
      sidebarPane: OSM.MapLibre.sidebarPane,
      Marker: OSM.MapLibre.Marker,
      LocationFilter: OSM.MapLibre.LocationFilter,
      csrf: OSM.csrf,
      blobHandler: OSM.getTurboBlobHandler,
      htmlHandler: OSM.turboHtmlResponseHandler,
      translation: OSM.i18n.t,
      tooltip: $.fn.tooltip
    };
    const viewport = map.getBounds();
    let filter, cleanup;
    const $ui = $("<div>").appendTo(document.body);
    $ui.html(`
      <input type="checkbox" id="link_marker"><input type="checkbox" id="image_filter">
      <input id="mapnik_scale" value="1000000">
      <a id="long_link" href="https://long.example:444/original?old=1#old"></a>
      <a id="short_link" href="http://short.example:8080/old?old=1#old"></a>
      <span><a id="embed_link" href="https://embed.example:9443/custom/embed?old=1#fragment"></a></span>
      <input id="long_input"><input id="short_input"><textarea id="embed_html"></textarea>
      <div id="nav-embed"></div><a id="geo_uri"></a><form id="export-image"></form>
      <input id="csrf_export"><input id="mapnik_minlon"><input id="mapnik_minlat">
      <input id="mapnik_maxlon"><input id="mapnik_maxlat"><input id="map_format">
      <input id="map_zoom"><input id="mapnik_lon"><input id="mapnik_lat">
      <input id="map_width"><input id="map_height"><span id="mapnik_image_width"></span>
      <span id="mapnik_image_height"></span><span id="mapnik_image_layer"></span>
      <div id="export-warning"></div><div id="mapnik_scale_row"></div>
    `);

    try {
      OSM.MapLibre.sidebarPane = () => ({
        registerCleanup(fn) {
          cleanup = fn;
        },
        loadContent() {}
      });
      OSM.MapLibre.Marker = class {
        on() {}
        off() {}
        getLngLat() { return new maplibregl.LngLat(190.56789, 11.23456); }
      };
      OSM.MapLibre.LocationFilter = class extends original.LocationFilter {
        constructor() {
          super();
          filter = this;
        }
        _drawFilter() {}
        _createMarkers() {}
        _removeMarkers() {}
        _removeLayers() {}
      };
      OSM.csrf = { authenticity_token: "token" };
      OSM.getTurboBlobHandler = () => () => {};
      OSM.turboHtmlResponseHandler = () => {};
      OSM.i18n.t = () => "View <larger> & map";
      $.fn.tooltip = function () {
        return this;
      };
      map.getBounds = () => viewport;
      map.getMapBaseLayer = () => ({ canEmbed: true, canDownloadImage: true, layerId: "mapnik", name: "Map" });
      map.getSize = () => ({ x: 800, y: 600 });
      map.hasLayer = () => included;
      map.on = () => {};
      map.off = () => {};

      const control = OSM.MapLibre.share({});
      control.onAddPane(map, null, $ui);
      control.onContentLoaded();
      $ui.trigger("show");

      expect($("#long_input").val()).to.eq($("#long_link").prop("href"));
      expect($("#short_input").val()).to.eq($("#short_link").prop("href"));
      expect($("#long_link").prop("origin")).to.eq("https://long.example:444");
      expect($("#long_link").prop("pathname")).to.eq("/");
      expect($("#short_link").prop("origin")).to.eq("http://short.example:8080");
      expect($("#short_link").prop("pathname")).to.match(/^\/go\//);
      expect($("#embed_link").prop("origin")).to.eq("https://embed.example:9443");
      expect($("#embed_link").prop("pathname")).to.eq("/custom/embed");
      expect($("#embed_html").val()).to.contain($("#embed_link").prop("href").replace(/&/g, "&amp;"));
      expect($("#embed_html").val()).to.contain($("#long_link").prop("href").replace(/&/g, "&amp;"));
      expect($("#embed_html").val()).to.contain("View &lt;larger&gt; &amp; map");
      expect($("#mapnik_minlon").val()).to.eq("181");

      included = false;
      $("#long_link").attr("href", "/");
      $("#embed_link").attr("href", "/export/embed.html");
      $("#image_filter").prop("checked", true).trigger("change");
      expect(filter.isEnabled()).to.eq(true);
      filter.setBounds(new maplibregl.LngLatBounds([2, 3], [4, 5]));
      expect($("#mapnik_minlon").val()).to.eq("2");
      expect($("#mapnik_minlat").val()).to.eq("3");
      expect($("#mapnik_maxlon").val()).to.eq("4");
      expect($("#mapnik_maxlat").val()).to.eq("5");
      expect(new URL($("#embed_link").prop("href")).searchParams.get("bbox")).to.eq("181,-10,200,30");
      expect(new URL($("#embed_link").prop("href")).searchParams.has("marker")).to.eq(false);
      expect(new URL($("#long_link").prop("href")).searchParams.has("mlat")).to.eq(false);
      expect(new URL($("#short_link").prop("href")).searchParams.has("m")).to.eq(false);
      expect($("#long_input").val()).to.eq($("#long_link").prop("href"));
      expect($("#long_link").prop("origin")).to.eq(new URL("/", document.baseURI).origin);
      expect($("#embed_link").prop("pathname")).to.eq("/export/embed.html");
      filter.setBounds(new maplibregl.LngLatBounds([6, 7], [8, 9]));
      expect($("#mapnik_minlon").val()).to.eq("6");
      expect($("#mapnik_minlat").val()).to.eq("7");
      expect($("#mapnik_maxlon").val()).to.eq("8");
      expect($("#mapnik_maxlat").val()).to.eq("9");
      expect(new URL($("#embed_link").prop("href")).searchParams.get("bbox")).to.eq("181,-10,200,30");
      $("#image_filter").prop("checked", false).trigger("change");
      expect($("#mapnik_minlon").val()).to.eq("181");
      expect($("#mapnik_maxlon").val()).to.eq("200");
      cleanup();
      let changes = 0;
      const observeChange = () => {
        changes++;
      };
      filter.on("change", observeChange);
      filter.addTo(map);
      filter.enable();
      filter.setBounds(new maplibregl.LngLatBounds([10, 11], [12, 13]));
      expect(changes).to.eq(1);
      expect($("#mapnik_minlon").val()).to.eq("181");
      expect($("#mapnik_maxlon").val()).to.eq("200");
      filter.off("change", observeChange);
      filter.remove();
    } finally {
      $ui.remove();
      OSM.MapLibre.sidebarPane = original.sidebarPane;
      OSM.MapLibre.Marker = original.Marker;
      OSM.MapLibre.LocationFilter = original.LocationFilter;
      OSM.csrf = original.csrf;
      OSM.getTurboBlobHandler = original.blobHandler;
      OSM.turboHtmlResponseHandler = original.htmlHandler;
      OSM.i18n.t = original.translation;
      $.fn.tooltip = original.tooltip;
    }
  });
});
