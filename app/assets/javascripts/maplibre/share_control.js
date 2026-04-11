//= require download_util

OSM.MapLibre.share = function (options) {
  const control = OSM.MapLibre.sidebarPane(options, "share", "javascripts.share.title", "javascripts.share.title"),
        marker = new OSM.MapLibre.Marker({ icon: "dot", color: "var(--marker-blue)", draggable: true }),
        locationFilter = new OSM.MapLibre.LocationFilter();

  function init(map, $ui) {
    // Link / Embed

    $ui.find("#link_marker").on("change", toggleMarker);

    $ui.find(".btn-group .btn")
      .on("shown.bs.tab", () => {
        $ui.find(".tab-pane.active [id]")
          .trigger("select");
      });

    $ui.find(".share-tab [id]").on("click", select);

    // Image

    $ui.find("#mapnik_scale").on("change", update);

    $ui.find("#image_filter").bind("change", toggleFilter);

    const csrfInput = $ui.find("#csrf_export")[0];
    [[csrfInput.name, csrfInput.value]] = Object.entries(OSM.csrf);

    document.getElementById("export-image")
      .addEventListener("turbo:submit-end",
                        OSM.getTurboBlobHandler(OSM.i18n.t("javascripts.share.filename")));

    document.getElementById("export-image")
      .addEventListener("turbo:before-fetch-response", OSM.turboHtmlResponseHandler);

    locationFilter.addTo(map);

    const updateEvents = ["moveend", "baselayerchange", "overlayadd", "overlayremove"];

    marker.on("dragend", movedMarker);
    map.on("move", movedMap);
    for (const e of updateEvents) {
      map.on(e, update);
    }

    control.registerCleanup(() => {
      marker.off("dragend", movedMarker);
      map.off("move", movedMap);
      for (const e of updateEvents) {
        map.off(e, update);
      }
      locationFilter.remove();
    });

    $ui
      .on("show", shown)
      .on("hide", hidden);

    update();

    function shown() {
      $("#mapnik_scale").val(getScale());
      update();
    }

    function hidden() {
      map.removeLayer(marker);
      locationFilter.disable();
      update();
    }

    function toggleMarker() {
      if ($(this).is(":checked")) {
        marker.setLngLat(map.getCenter());
        map.addLayer(marker);
      } else {
        map.removeLayer(marker);
      }
      update();
    }

    function toggleFilter() {
      if ($(this).is(":checked")) {
        locationFilter.setBounds(OSM.MapLibre.padBounds(map.getBounds(), -0.2));
        locationFilter.enable();
      } else {
        locationFilter.disable();
      }
      update();
    }

    function movedMap() {
      marker.setLngLat(map.getCenter());
      update();
    }

    function movedMarker() {
      if (map.hasLayer(marker)) {
        map.off("move", movedMap);
        map.once("moveend", function () {
          map.on("move", movedMap);
          update();
        });
        map.panTo(marker.getLngLat());
      }
    }

    function escapeHTML(string) {
      const htmlEscapes = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#x27;"
      };
      return string === null ? "" : String(string).replace(/[&<>"']/g, function (match) {
        return htmlEscapes[match];
      });
    }

    function update() {
      const layer = map.getMapBaseLayer();
      const canEmbed = Boolean(layer && layer.canEmbed);
      let bounds = map.getBounds();

      const shortUrl = map.getShortUrl(marker);
      const longUrl = map.getUrl(marker);
      const geoUri = map.getGeoUri(marker);

      $("#link_marker")
        .prop("checked", map.hasLayer(marker));

      $("#image_filter")
        .prop("checked", locationFilter.isEnabled());

      // Link / Embed

      $("#short_input").val(shortUrl);
      $("#long_input").val(longUrl);
      $("#short_link").attr("href", shortUrl);
      $("#long_link").attr("href", longUrl);

      const params = new URLSearchParams({
        bbox: OSM.MapLibre.boundsToBBoxString(bounds),
        layer: map.getMapBaseLayerId()
      });

      if (map.hasLayer(marker)) {
        const latLng = marker.getLngLat().wrap();
        params.set("marker", latLng.lat + "," + latLng.lng);
      }

      if (!canEmbed && $("#nav-embed").hasClass("active")) {
        bootstrap.Tab.getOrCreateInstance($("#long_link")).show();
      }
      $("#embed_link")
        .toggleClass("disabled", !canEmbed)
        .parent()
        .tooltip(canEmbed ? "disable" : "enable");

      $("#embed_html").val(
        "<iframe width=\"425\" height=\"350\" src=\"" +
          escapeHTML(OSM.SERVER_PROTOCOL + "://" + OSM.SERVER_URL + "/export/embed.html?" + params) +
          "\" style=\"border: 1px solid black\"></iframe><br/>" +
          "<small><a href=\"" + escapeHTML(longUrl) + "\">" +
          escapeHTML(OSM.i18n.t("javascripts.share.view_larger_map")) + "</a></small>");

      // Geo URI

      $("#geo_uri")
        .attr("href", geoUri)
        .text(geoUri);

      // Image

      if (locationFilter.isEnabled()) {
        bounds = locationFilter.getBounds();
      }

      let scale = $("#mapnik_scale").val();
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      const swProj = mercatorProject(sw);
      const neProj = mercatorProject(ne);
      const sizeX = Math.abs(neProj.x - swProj.x);
      const sizeY = Math.abs(neProj.y - swProj.y);
      const maxScale = Math.floor(Math.sqrt(sizeX * sizeY / 0.3136));

      $("#mapnik_minlon").val(bounds.getWest());
      $("#mapnik_minlat").val(bounds.getSouth());
      $("#mapnik_maxlon").val(bounds.getEast());
      $("#mapnik_maxlat").val(bounds.getNorth());

      if (scale < maxScale) {
        scale = roundScale(maxScale);
        $("#mapnik_scale").val(scale);
      }

      const mapWidth = Math.round(sizeX / scale / 0.00028);
      const mapHeight = Math.round(sizeY / scale / 0.00028);
      $("#mapnik_image_width").text(mapWidth);
      $("#mapnik_image_height").text(mapHeight);

      const canDownloadImage = Boolean(layer && layer.canDownloadImage);

      $("#mapnik_image_layer").text(canDownloadImage ? layer.name : "");
      $("#map_format").val(canDownloadImage ? layer.layerId : "");

      $("#map_zoom").val(map.getZoom() + OSM.ZOOM_OFFSET);
      $("#mapnik_lon").val(map.getCenter().lng);
      $("#mapnik_lat").val(map.getCenter().lat);
      $("#map_width").val(mapWidth);
      $("#map_height").val(mapHeight);

      $("#export-image").toggle(canDownloadImage);
      $("#export-warning").toggle(!canDownloadImage);
      $("#mapnik_scale_row").toggle(canDownloadImage && layer.layerId === "mapnik");
    }

    function mercatorProject(ll) {
      const earthRadius = 6378137;
      const x = ((ll.lng * Math.PI) / 180) * earthRadius;
      const y = Math.log(Math.tan((Math.PI / 4) + ((ll.lat * Math.PI) / 360))) * earthRadius;
      return { x, y };
    }

    function select() {
      $(this).trigger("select");
    }

    function getScale() {
      const bounds = map.getBounds(),
            centerLat = bounds.getCenter().lat,
            halfWorldMeters = 6378137 * Math.PI * Math.cos(centerLat * Math.PI / 180),
            meters = halfWorldMeters * (bounds.getEast() - bounds.getWest()) / 180,
            pixelsPerMeter = map.getSize().x / meters,
            metersPerPixel = 1 / (92 * 39.3701);
      return Math.round(1 / (pixelsPerMeter * metersPerPixel));
    }

    function roundScale(scale) {
      const precision = 5 * Math.pow(10, Math.floor(Math.LOG10E * Math.log(scale)) - 2);
      return precision * Math.ceil(scale / precision);
    }
  }

  control.onAddPane = function (map, button, $ui) {
    $("#content").addClass("overlay-right-sidebar");

    control.onContentLoaded = () => init(map, $ui);
    $ui.one("show", control.loadContent);
  };

  return control;
};
