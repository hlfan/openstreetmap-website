//= require_self
//= require numbered_pagination
//= require maplibre/sidebar
//= require maplibre/sidebar_pane
//= require maplibre/layers_control
//= require maplibre/legend_control
//= require maplibre/note_control
//= require maplibre/share_control
//= require maplibre/query_control
//= require maplibre/location_filter
//= require index/contextmenu
//= require index/initializations
//= require index/layers/data
//= require index/layers/notes
//= require router

OSM.initializations = [];

$(function () {
  const map = new OSM.MapLibre.MainMap({
    container: "map"
  });
  window.__map__ = map;

  OSM.loadSidebarContent = function (path) {
    map.setSidebarOverlaid(false);

    return new Promise((resolve, reject) => {
      $("#sidebar_content_frame")
        .one("turbo:frame-render", event => {
          const response = event.originalEvent.detail.fetchResponse.response;

          const title = response.headers.get("X-Page-Title");
          if (title) document.title = decodeURIComponent(title);

          if (response.ok) {
            resolve();
          } else {
            reject(new Error(`HTTP Error ${response.status} ${response.statusText}`));
          }
        })
        .prop("src", path);
    });
  };

  $("#sidebar_content_frame")
    .on("turbo:before-fetch-response", () => $("#flash").empty())
    .on("turbo:before-frame-render", event => {
      const atomSelector = "link[type='application/atom+xml']";
      $("head").find(atomSelector).remove();
      $("head").append(
        $(event.originalEvent.detail.newFrame)
          .find(atomSelector)
          .detach());
    });

  const token = $("head").data("oauthToken");
  if (token) OSM.oauth = { authorization: "Bearer " + token };

  const params = OSM.mapParams();

  map.updateLayers(params.layers);

  map.on("baselayerchange", function (e) {
    const maxZoom = e.layer?.maxZoom;
    if (maxZoom && map.getZoom() > maxZoom) {
      map.setView(map.getCenter(), maxZoom, { reset: true });
    }
  });

  const sidebar = OSM.MapLibre.sidebar("#map-ui")
    .addTo(map);

  const position = $("html").attr("dir") === "rtl" ? "top-left" : "top-right";

  map.addControl(new OSM.MapLibre.CombinedControlGroup([
    new OSM.MapLibre.NavigationControl(),
    new OSM.MapLibre.GeolocateControl()
  ]), position);

  const layersControl = OSM.MapLibre.layers({
    position,
    sidebar,
    layers: map.baseLayers
  });

  const legendControl = OSM.MapLibre.legend({ position, sidebar });

  const shareControl = OSM.MapLibre.share({
    position,
    sidebar,
    "short": true
  });

  const noteControl = OSM.MapLibre.note({ position, sidebar });
  const queryControl = OSM.MapLibre.query({ position, sidebar });

  map.addControl(layersControl, position);
  map.addControl(legendControl, position);
  map.addControl(shareControl, position);
  map.addControl(noteControl, position);
  map.addControl(queryControl, position);

  map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
  map.addControl(new maplibregl.ScaleControl({ unit: "imperial" }), "bottom-left");

  OSM.initializations.forEach(func => func(map));

  // Position the map before any overlays are added so that overlay init
  // (e.g. `dataLayer.on("add", ...)` fetching via `map.getBounds()`) sees
  // the intended viewport rather than the default unpositioned bounds.
  if (params.bounds) {
    map.fitBounds(params.bounds);
  } else {
    map.setView({ lng: params.lon, lat: params.lat }, params.zoom);
  }

  if (OSM.STATUS !== "api_offline" && OSM.STATUS !== "database_offline") {
    OSM.initializeNotesLayer(map);
    if (params.layers.indexOf(map.noteLayer.options.code) >= 0) {
      map.addLayer(map.noteLayer);
    }

    OSM.initializeDataLayer(map);
    if (params.layers.indexOf(map.dataLayer.options.code) >= 0) {
      map.addLayer(map.dataLayer);
    }

    if (params.layers.indexOf(map.gpsLayer.options.code) >= 0) {
      map.addLayer(map.gpsLayer);
    }
  }

  $(".maplibregl-ctrl .control-button, .control-button").tooltip({ placement: "left", container: "body" });

  const expires = new Date();
  const thisYear = expires.getFullYear();
  expires.setFullYear(thisYear + 10);

  const updateCookieAndLinks = function () {
    updateLinks(
      map.getCenter().wrap(),
      map.getZoom(),
      map.getLayersCode(),
      map._object);

    OSM.cookies.set("_osm_location", OSM.locationCookie(map), { expires });
  };
  for (const e of ["moveend", "baselayerchange", "overlayadd", "overlayremove"]) {
    map.on(e, updateCookieAndLinks);
  }
  // Trigger once at page load so links, cookie, and the #edit_tab tooltip
  // are initialized from the current map state (the moveend from setView
  // above fires before this listener is attached).
  updateCookieAndLinks();

  if (OSM.cookies.get("_osm_welcome") !== "hide") {
    $(".welcome").addClass("d-md-block");
  }

  $(".welcome .btn-close").on("click", function () {
    $(".welcome").removeClass("d-md-block");
    OSM.cookies.set("_osm_welcome", "hide", { expires });
  });

  expires.setFullYear(thisYear + 1);

  $("#banner .btn-close").on("click", function (e) {
    const cookieId = e.target.id;
    $("#banner").removeClass("d-md-block");
    e.preventDefault();
    if (cookieId) {
      OSM.cookies.set(cookieId, "hide", { expires });
    }
  });

  if (OSM.MATOMO) {
    const matomoLayerHandler = function (e) {
      const layerOptions = e.layer;
      if (layerOptions) {
        const goal = OSM.MATOMO.goals[layerOptions.layerId];

        if (goal) {
          $("body").trigger("matomogoal", goal);
        }
      }
    };
    map.on("baselayerchange", matomoLayerHandler);
    map.on("overlayadd", matomoLayerHandler);
  }

  if (params.marker && params.mrad) {
    const circleGeoJSON = OSM.MapLibre.circleGeoJSON(
      { lat: params.mlat, lng: params.mlon }, params.mrad
    );
    const circleStyle = { color: "#03f", fillOpacity: 0.2, weight: 2, opacity: 0.5 };
    map.onceStyleReady(() => {
      OSM.MapLibre.addGeoJSONLayer(map, "url-marker-circle", circleGeoJSON, circleStyle);
    });
  } else if (params.marker) {
    new OSM.MapLibre.Marker({ icon: "dot", color: "var(--marker-blue)" })
      .setLngLat([params.mlon, params.mlat])
      .addTo(map);
  }

  function remoteEditHandler(bbox, object) {
    const remoteEditHost = "http://127.0.0.1:8111",
          osmHost = location.protocol + "//" + location.host,
          query = new URLSearchParams({
            left: bbox.getWest() - 0.0001,
            top: bbox.getNorth() + 0.0001,
            right: bbox.getEast() + 0.0001,
            bottom: bbox.getSouth() - 0.0001
          });

    if (object && object.type !== "note") query.set("select", object.type + object.id); // can't select notes
    sendRemoteEditCommand(remoteEditHost + "/load_and_zoom?" + query)
      .then(() => {
        if (object && object.type === "note") {
          const noteQuery = new URLSearchParams({ url: osmHost + OSM.apiUrl(object) });
          sendRemoteEditCommand(remoteEditHost + "/import?" + noteQuery);
        }
      })
      .catch(() => {
        OSM.showAlert(OSM.i18n.t("javascripts.remote_edit.failed.title"),
                      OSM.i18n.t("javascripts.remote_edit.failed.body"));
      });

    function sendRemoteEditCommand(url) {
      return fetch(url, { mode: "no-cors", signal: AbortSignal.timeout(5000) });
    }

    return false;
  }

  $("a[data-editor=remote]").click(function (e) {
    const params = OSM.mapParams(this.search);
    remoteEditHandler(map.getBounds(), params.object);
    e.preventDefault();
  });

  if (new URLSearchParams(location.search).get("edit_help")) {
    $("#editanchor")
      .removeAttr("title")
      .tooltip({
        placement: "bottom",
        title: OSM.i18n.t("javascripts.edit_help")
      })
      .tooltip("show");

    $("body").one("click", function () {
      $("#editanchor").tooltip("hide");
    });
  }

  OSM.router = OSM.Router(map, {
    "/": "index",
    "/search": "search",
    "/directions": "directions",
    "/export": "export",
    "/note/new": "new_note",
    "/history/friends": "history",
    "/history/nearby": "history",
    "/history": "history",
    "/user/:display_name/history": "history",
    "/note/:id": "note",
    "/node/:id(/history)": { module: "index_element", part: m => m.mappedElement("node") },
    "/node/:id/history/:version": { module: "index_element", part: m => m.mappedElement("node") },
    "/way/:id(/history)": { module: "index_element", part: m => m.mappedElement("way") },
    "/way/:id/history/:version": { module: "index_element", part: m => m.element("way") },
    "/relation/:id(/history)": { module: "index_element", part: m => m.mappedElement("relation") },
    "/relation/:id/history/:version": { module: "index_element", part: m => m.element("relation") },
    "/changeset/:id": "changeset",
    "/query": "query",
    "/account/home": "home"
  });

  if (OSM.preferred_editor === "remote" && location.pathname === "/edit") {
    remoteEditHandler(map.getBounds(), params.object);
    OSM.router.setCurrentPath("/");
  }

  OSM.router.load();

  $(document).on("click", "a", function (e) {
    if (e.isDefaultPrevented() || e.isPropagationStopped() || $(e.target).data("turbo")) {
      return;
    }

    // Open links in a new tab as normal.
    if (e.which > 1 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }

    // Open local anchor links as normal.
    if ($(this).attr("href")?.startsWith("#")) {
      return;
    }

    // Ignore cross-protocol and cross-origin links.
    const url = new URL($(this).attr("href"), location);
    if (location.protocol !== url.protocol || location.host !== url.host) {
      return;
    }

    if (OSM.router.route(url.pathname + url.search + url.hash)) {
      e.preventDefault();
      if (url.pathname !== "/directions") {
        $(".navbar-toggler:not(.collapsed)").trigger("click");
      }
    }
  });

  $(document).on("click", "#sidebar .sidebar-close-controls button", function () {
    $(".search_form input[name=query]").val("");
    OSM.router.route("/" + OSM.formatHash(map));
  });
});
