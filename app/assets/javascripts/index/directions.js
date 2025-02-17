//= require ./directions-endpoint
//= require_self
//= require_tree ./directions

OSM.Directions = function (map) {
  let controller = null; // the AbortController for the current route request if a route request is in progress
  let chosenEngine;

  const popup = L.popup({ autoPanPadding: [100, 100] });

  const polyline = L.polyline([], {
    color: "#03f",
    opacity: 0.3,
    weight: 10
  });

  const highlight = L.polyline([], {
    color: "#ff0",
    opacity: 0.5,
    weight: 12
  });

  const endpointDragCallback = function (dragging) {
    if (!map.hasLayer(polyline)) return;
    if (dragging && !chosenEngine.draggable) return;
    if (dragging && controller) return;

    getRoute(false, !dragging);
  };
  const endpointChangeCallback = function () {
    getRoute(true, true);
  };

  const endpoints = [
    OSM.DirectionsEndpoint(map, $("input[name='route_from']"), OSM.MARKER_GREEN, endpointDragCallback, endpointChangeCallback),
    OSM.DirectionsEndpoint(map, $("input[name='route_to']"), OSM.MARKER_RED, endpointDragCallback, endpointChangeCallback)
  ];

  const expiry = new Date();
  expiry.setYear(expiry.getFullYear() + 10);

  const modeIconPaths = {
    car: "M2.52 3.515A2.5 2.5 0 0 1 4.82 2h6.362c1 0 1.904.596 2.298 1.515l.792 1.848c.075.175.21.319.38.404.5.25.855.715.965 1.262l.335 1.679q.05.242.049.49v.413c0 .814-.39 1.543-1 1.997V13.5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1-.5-.5v-1.338c-1.292.048-2.745.088-4 .088s-2.708-.04-4-.088V13.5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1-.5-.5v-1.892c-.61-.454-1-1.183-1-1.997v-.413a2.5 2.5 0 0 1 .049-.49l.335-1.68c.11-.546.465-1.012.964-1.261a.8.8 0 0 0 .381-.404l.792-1.848ZM3 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2m10 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2M6 8a1 1 0 0 0 0 2h4a1 1 0 1 0 0-2zM2.906 5.189a.51.51 0 0 0 .497.731c.91-.073 3.35-.17 4.597-.17s3.688.097 4.597.17a.51.51 0 0 0 .497-.731l-.956-1.913A.5.5 0 0 0 11.691 3H4.309a.5.5 0 0 0-.447.276L2.906 5.19Z",
    bicycle: "M4 4.5a.5.5 0 0 1 .5-.5H6a.5.5 0 0 1 0 1v.5h4.14l.386-1.158A.5.5 0 0 1 11 4h1a.5.5 0 0 1 0 1h-.64l-.311.935.807 1.29a3 3 0 1 1-.848.53l-.508-.812-2.076 3.322A.5.5 0 0 1 8 10.5H5.959a3 3 0 1 1-1.815-3.274L5 5.856V5h-.5a.5.5 0 0 1-.5-.5m1.5 2.443-.508.814c.5.444.85 1.054.967 1.743h1.139zM8 9.057 9.598 6.5H6.402zM4.937 9.5a2 2 0 0 0-.487-.877l-.548.877zM3.603 8.092A2 2 0 1 0 4.937 10.5H3a.5.5 0 0 1-.424-.765zm7.947.53a2 2 0 1 0 .848-.53l1.026 1.643a.5.5 0 1 1-.848.53z",
    foot: "M9.5 1.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0M6.44 3.752A.75.75 0 017 3.5h1.445c.742 0 1.32.643 1.243 1.38l-.43 4.083a1.8 1.8 0 01-.088.395l-.318.906.213.242a.8.8 0 01.114.175l2 4.25a.75.75 0 11-1.357.638l-1.956-4.154-1.68-1.921A.75.75 0 016 8.96l.138-2.613-.435.489-.464 2.786a.75.75 0 11-1.48-.246l.5-3a.75.75 0 01.18-.375l2-2.25zm-.19 7.993v-1.418l1.204 1.375.261.524a.8.8 0 01-.12.231l-2.5 3.25a.75.75 0 11-1.19-.914zm4.22-4.215-.494-.494.205-1.843.006-.067 1.124 1.124h1.44a.75.75 0 010 1.5H11a.75.75 0 01-.531-.22Z"
  };

  const modeGroup = $(".routing_modes");
  const select = $("select.routing_engines");

  $(".directions_form .reverse_directions").on("click", function () {
    const coordFrom = endpoints[0].latlng,
          coordTo = endpoints[1].latlng;
    let routeFrom = "",
        routeTo = "";
    if (coordFrom) {
      routeFrom = coordFrom.lat + "," + coordFrom.lng;
    }
    if (coordTo) {
      routeTo = coordTo.lat + "," + coordTo.lng;
    }
    endpoints[0].swapCachedReverseGeocodes(endpoints[1]);

    OSM.router.route("/directions?" + new URLSearchParams({
      route: routeTo + ";" + routeFrom
    }));
  });

  $(".directions_form .btn-close").on("click", function (e) {
    e.preventDefault();
    $(".describe_location").toggle(!endpoints[0].value);
    $(".search_form input[name='query']").val(endpoints[0].value);
    OSM.router.route("/" + OSM.formatHash(map));
  });

  function formatDistance(m) {
    const unitTemplate = "javascripts.directions.distance_";
    if (m < 1000) return I18n.t(unitTemplate + "m", { distance: Math.round(m) });
    if (m < 10000) return I18n.t(unitTemplate + "km", { distance: (m / 1000.0).toFixed(1) });
    return I18n.t(unitTemplate + "km", { distance: Math.round(m / 1000) });
  }

  function formatHeight(m) {
    return I18n.t("javascripts.directions.distance_m", { distance: Math.round(m) });
  }

  function formatTime(s) {
    let m = Math.round(s / 60);
    const h = Math.floor(m / 60);
    m -= h * 60;
    return h + ":" + (m < 10 ? "0" : "") + m;
  }

  function setEngine(id) {
    const engines = OSM.Directions.engines;
    const desired = engines.find(engine => engine.id() === id);
    if (!desired || (chosenEngine && chosenEngine.id() === id)) return;
    chosenEngine = desired;

    const modes = engines
      .filter(engine => engine.provider === chosenEngine.provider)
      .map(engine => engine.mode)
      .sort((a, b) => I18n.t("javascripts.directions.modes." + a).localeCompare(I18n.t("javascripts.directions.modes." + b)));
    modeGroup.html("");
    for (const mode of new Set(modes)) {
      modeGroup.append(`<input type="radio" class="btn-check" name="modes" id="${mode}" autocomplete="off">`);
      modeGroup.append(`<label class="btn btn-outline-secondary px-2" for="${mode}" title="${
        I18n.t("javascripts.directions.modes." + mode)
      }"><svg class="d-block" width="16" height="16" fill="currentColor"><path d="${modeIconPaths[mode]}"></path></svg></label>`);
    }
    $(".routing_modes input#" + chosenEngine.mode).prop("checked", true);

    const providers = engines
      .filter(engine => engine.mode === chosenEngine.mode)
      .map(engine => engine.provider)
      .sort((a, b) => I18n.t("javascripts.directions.providers." + a).localeCompare(I18n.t("javascripts.directions.providers." + b)));
    select.html("");
    for (const provider of new Set(providers)) {
      select.append(`<option value="${provider}">${
        I18n.t("javascripts.directions.providers." + provider)
      }</option>`);
    }
    select.val(chosenEngine.provider);
  }

  function getRoute(fitRoute, reportErrors) {
    // Cancel any route that is already in progress
    if (controller) controller.abort();

    const points = endpoints.map(p => p.latlng);

    if (!points[0] || !points[1]) return;
    $("header").addClass("closed");

    OSM.router.replace("/directions?" + new URLSearchParams({
      engine: chosenEngine.id(),
      route: points.map(p => OSM.cropLocation(p, map.getZoom()).join()).join(";")
    }));

    // copy loading item to sidebar and display it. we copy it, rather than
    // just using it in-place and replacing it in case it has to be used
    // again.
    $("#sidebar_content").html($(".directions_form .loader_copy").html());
    map.setSidebarOverlaid(false);
    controller = new AbortController();
    chosenEngine.getRoute(points, controller.signal).then(function (route) {
      polyline
        .setLatLngs(route.line)
        .addTo(map);

      if (fitRoute) {
        map.fitBounds(polyline.getBounds().pad(0.05));
      }

      const distanceText = $("<p>").append(
        I18n.t("javascripts.directions.distance") + ": " + formatDistance(route.distance) + ". " +
        I18n.t("javascripts.directions.time") + ": " + formatTime(route.time) + ".");
      if (typeof route.ascend !== "undefined" && typeof route.descend !== "undefined") {
        distanceText.append(
          $("<br>"),
          I18n.t("javascripts.directions.ascend") + ": " + formatHeight(route.ascend) + ". " +
          I18n.t("javascripts.directions.descend") + ": " + formatHeight(route.descend) + ".");
      }

      const turnByTurnTable = $("<table class='table table-hover table-sm mb-3'>")
        .append($("<tbody>"));
      const directionsCloseButton = $("<button type='button' class='btn-close'>")
        .attr("aria-label", I18n.t("javascripts.close"));

      $("#sidebar_content")
        .empty()
        .append(
          $("<div class='d-flex'>").append(
            $("<h2 class='flex-grow-1 text-break'>")
              .text(I18n.t("javascripts.directions.directions")),
            $("<div>").append(directionsCloseButton)),
          distanceText,
          turnByTurnTable
        );

      // Add each row
      route.steps.forEach(function (step) {
        const [ll, direction, instruction, dist, lineseg] = step;

        const row = $("<tr class='turn'/>");
        row.append("<td class='border-0'><div class='direction i" + direction + "'/></td> ");
        row.append("<td>" + instruction);
        row.append("<td class='distance text-body-secondary text-end'>" + getDistText(dist));

        row.on("click", function () {
          popup
            .setLatLng(ll)
            .setContent("<p>" + instruction + "</p>")
            .openOn(map);
        });

        row.hover(function () {
          highlight
            .setLatLngs(lineseg)
            .addTo(map);
        }, function () {
          map.removeLayer(highlight);
        });

        turnByTurnTable.append(row);
      });

      $("#sidebar_content").append("<p class=\"text-center\">" +
        I18n.t("javascripts.directions.instructions.courtesy", { link: chosenEngine.creditline }) +
        "</p>");

      directionsCloseButton.on("click", function () {
        map.removeLayer(polyline);
        $("#sidebar_content").html("");
        popup.close();
        map.setSidebarOverlaid(true);
        // TODO: collapse width of sidebar back to previous
      });
    }).catch(function () {
      map.removeLayer(polyline);
      if (reportErrors) {
        $("#sidebar_content").html("<div class=\"alert alert-danger\">" + I18n.t("javascripts.directions.errors.no_route") + "</div>");
      }
    }).finally(function () {
      controller = null;
    });

    function getDistText(dist) {
      if (dist < 5) return "";
      if (dist < 200) return String(Math.round(dist / 10) * 10) + "m";
      if (dist < 1500) return String(Math.round(dist / 100) * 100) + "m";
      if (dist < 5000) return String(Math.round(dist / 100) / 10) + "km";
      return String(Math.round(dist / 1000)) + "km";
    }
  }

  setEngine("fossgis_osrm_car");
  setEngine(Cookies.get("_osm_directions_engine"));

  modeGroup.on("change", "input[name='modes']", function (e) {
    setEngine(chosenEngine.provider + "_" + e.target.id);
    Cookies.set("_osm_directions_engine", chosenEngine.id(), { secure: true, expires: expiry, path: "/", samesite: "lax" });
    getRoute(true, true);
  });

  select.on("change", function (e) {
    setEngine(e.target.selectedOptions[0].value + "_" + chosenEngine.mode);
    Cookies.set("_osm_directions_engine", chosenEngine.id(), { secure: true, expires: expiry, path: "/", samesite: "lax" });
    getRoute(true, true);
  });

  $(".directions_form").on("submit", function (e) {
    e.preventDefault();
    getRoute(true, true);
  });

  $(".routing_marker_column img").on("dragstart", function (e) {
    const dt = e.originalEvent.dataTransfer;
    dt.effectAllowed = "move";
    const dragData = { type: $(this).data("type") };
    dt.setData("text", JSON.stringify(dragData));
    if (dt.setDragImage) {
      const img = $("<img>").attr("src", $(e.originalEvent.target).attr("src"));
      dt.setDragImage(img.get(0), 12, 21);
    }
  });

  const page = {};

  page.pushstate = page.popstate = function () {
    $(".search_form").hide();
    $(".directions_form").show();

    $("#map").on("dragend dragover", function (e) {
      e.preventDefault();
    });

    $("#map").on("drop", function (e) {
      e.preventDefault();
      const oe = e.originalEvent;
      const dragData = JSON.parse(oe.dataTransfer.getData("text"));
      const type = dragData.type;
      const pt = L.DomEvent.getMousePosition(oe, map.getContainer()); // co-ordinates of the mouse pointer at present
      pt.y += 20;
      const ll = map.containerPointToLatLng(pt);
      const llWithPrecision = OSM.cropLocation(ll, map.getZoom());
      endpoints[type === "from" ? 0 : 1].setValue(llWithPrecision.join(", "));
    });

    endpoints[0].enable();
    endpoints[1].enable();

    const params = new URLSearchParams(location.search),
          route = (params.get("route") || "").split(";");

    if (params.has("engine")) setEngine(params.get("engine"));

    endpoints[0].setValue(params.get("from") || route[0] || "");
    endpoints[1].setValue(params.get("to") || route[1] || "");

    map.setSidebarOverlaid(!endpoints[0].latlng || !endpoints[1].latlng);
  };

  page.load = function () {
    page.pushstate();
  };

  page.unload = function () {
    $(".search_form").show();
    $(".directions_form").hide();
    $("#map").off("dragend dragover drop");

    endpoints[0].disable();
    endpoints[1].disable();

    map
      .removeLayer(popup)
      .removeLayer(polyline);
  };

  return page;
};

OSM.Directions.engines = [];

OSM.Directions.addEngine = function (engine, supportsHTTPS) {
  if (document.location.protocol === "http:" || supportsHTTPS) {
    engine.id = () => engine.provider + "_" + engine.mode;
    OSM.Directions.engines.push(engine);
  }
};
