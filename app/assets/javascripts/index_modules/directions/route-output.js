/* exported RouteOutput */
function RouteOutput(map) {
  const popup = new OSM.MapLibre.Popup({ anchor: "bottom", offset: [0, -5] });

  const routeSourceId = "directions-route";
  const highlightSourceId = "directions-highlight";
  let currentRoute = null;

  let distanceUnits = "km_m";
  let downloadURL = null;

  function translateDistanceUnits(m) {
    if (distanceUnits === "mi_ft") {
      return [m / 0.3048, "ft", m / 1609.344, "mi"];
    } else if (distanceUnits === "mi_yd") {
      return [m / 0.9144, "yd", m / 1609.344, "mi"];
    } else {
      return [m, "m", m / 1000, "km"];
    }
  }

  function formatTotalDistance(minorValue, minorName, majorValue, majorName) {
    const scope = "javascripts.directions.distance_in_units";

    if (minorValue < 1000 || majorValue < 0.25) {
      return OSM.i18n.t(minorName, { scope, distance: Math.round(minorValue) });
    } else if (majorValue < 10) {
      return OSM.i18n.t(majorName, { scope, distance: majorValue.toFixed(1) });
    } else {
      return OSM.i18n.t(majorName, { scope, distance: Math.round(majorValue) });
    }
  }

  function formatStepDistance(minorValue, minorName, majorValue, majorName) {
    const scope = "javascripts.directions.distance_in_units";

    if (minorValue < 5) {
      return "";
    } else if (minorValue < 200) {
      return OSM.i18n.t(minorName, { scope, distance: Math.round(minorValue / 10) * 10 });
    } else if (minorValue < 1500 || majorValue < 0.25) {
      return OSM.i18n.t(minorName, { scope, distance: Math.round(minorValue / 100) * 100 });
    } else if (majorValue < 5) {
      return OSM.i18n.t(majorName, { scope, distance: majorValue.toFixed(1) });
    } else {
      return OSM.i18n.t(majorName, { scope, distance: Math.round(majorValue) });
    }
  }

  function formatHeight(minorValue, minorName) {
    const scope = "javascripts.directions.distance_in_units";

    return OSM.i18n.t(minorName, { scope, distance: Math.round(minorValue) });
  }

  function formatTime(s) {
    let m = Math.round(s / 60);
    const h = Math.floor(m / 60);

    m -= h * 60;

    return h + ":" + (m < 10 ? "0" : "") + m;
  }

  function writeSummary(route) {
    $("#directions_route_distance").val(formatTotalDistance(...translateDistanceUnits(route.distance)));
    $("#directions_route_time").val(formatTime(route.time));

    if (typeof route.ascend !== "undefined" && typeof route.descend !== "undefined") {
      $("#directions_route_ascend_descend").prop("hidden", false);
      $("#directions_route_ascend").val(formatHeight(...translateDistanceUnits(route.ascend)));
      $("#directions_route_descend").val(formatHeight(...translateDistanceUnits(route.descend)));
    } else {
      $("#directions_route_ascend_descend").prop("hidden", true);
      $("#directions_route_ascend").val("");
      $("#directions_route_descend").val("");
    }
  }

  function writeSteps(route) {
    $("#directions_route_steps").empty();

    for (const [i, [direction, instruction, dist, lineseg]] of route.steps.entries()) {
      const row = $("<tr class='turn'/>").appendTo($("#directions_route_steps"));

      if (direction) {
        row.append("<td class='ps-3'><svg width='20' height='20' class='d-block'><use href='#routing-sprite-" + direction + "' /></svg></td>");
      } else {
        row.append("<td class='ps-3'>");
      }

      row.append(`<td class="text-break"><b>${i + 1}.</b> ${instruction}`);
      row.append("<td class='pe-3 distance text-body-secondary text-end'>" + formatStepDistance(...translateDistanceUnits(dist)));

      row.on("click", function () {
        const ll = lineseg[0];
        popup
          .setLngLat([ll.lng, ll.lat])
          .setHTML(`<p><b>${i + 1}.</b> ${instruction}</p>`)
          .addTo(map);
        map.panInside([ll.lng, ll.lat], { padding: [100, 100] });
      });

      row
        .on("mouseenter", function () {
          const geojson = OSM.MapLibre.lineGeoJSON(lineseg);
          if (map.getSource(highlightSourceId)) {
            OSM.MapLibre.updateGeoJSONSource(map, highlightSourceId, geojson);
          } else {
            OSM.MapLibre.addGeoJSONLayer(map, highlightSourceId, geojson, {
              color: "#ff0",
              weight: 12,
              opacity: 0.5
            });
          }
        })
        .on("mouseleave", function () {
          OSM.MapLibre.removeGeoJSONLayer(map, highlightSourceId);
        });
    }
  }

  const routeOutput = {};

  // Re-add the route after a base-layer switch: MainMap uses
  // setStyle({diff:false}) which wipes custom sources and layers, so the
  // blue polyline would otherwise disappear until the user resubmits the
  // form. The highlight is transient (mouseenter/mouseleave), so nothing
  // to restore for it.
  function restoreRouteOnStyleLoad() {
    if (!currentRoute) return;
    if (map.getSource(routeSourceId)) return;
    const routeGeoJSON = OSM.MapLibre.lineGeoJSON(currentRoute.line);
    OSM.MapLibre.addGeoJSONLayer(map, routeSourceId, routeGeoJSON, {
      color: "#03f",
      weight: 10,
      opacity: 0.3
    });
  }
  map.on("style.load", restoreRouteOnStyleLoad);

  routeOutput.write = function (route) {
    currentRoute = route;

    const routeGeoJSON = OSM.MapLibre.lineGeoJSON(route.line);
    if (map.getSource(routeSourceId)) {
      OSM.MapLibre.updateGeoJSONSource(map, routeSourceId, routeGeoJSON);
    } else {
      OSM.MapLibre.addGeoJSONLayer(map, routeSourceId, routeGeoJSON, {
        color: "#03f",
        weight: 10,
        opacity: 0.3
      });
    }

    writeSummary(route);
    writeSteps(route);

    $("#directions_distance_units_settings input").off().on("change", function () {
      distanceUnits = this.value;
      writeSummary(route);
      writeSteps(route);
    });

    const blob = new Blob([JSON.stringify(routeGeoJSON)], { type: "application/geo+json" });

    URL.revokeObjectURL(downloadURL);
    downloadURL = URL.createObjectURL(blob);
    $("#directions_route_download").prop("href", downloadURL);

    $("#directions_route_credit")
      .text(route.credit)
      .prop("href", route.creditlink);
    $("#directions_route_demo")
      .text(route.credit)
      .prop("href", route.demolink);
  };

  routeOutput.fit = function () {
    if (!currentRoute) return;
    const bounds = OSM.MapLibre.getGeoJSONBounds(OSM.MapLibre.lineGeoJSON(currentRoute.line));
    map.fitBounds(OSM.MapLibre.padBounds(bounds, 0.05));
  };

  routeOutput.isVisible = function () {
    return Boolean(map.getSource(routeSourceId));
  };

  routeOutput.remove = function () {
    popup.remove();
    map.off("style.load", restoreRouteOnStyleLoad);
    OSM.MapLibre.removeGeoJSONLayer(map, routeSourceId);
    OSM.MapLibre.removeGeoJSONLayer(map, highlightSourceId);
    currentRoute = null;

    $("#directions_distance_units_settings input").off();

    $("#directions_route_steps").empty();

    URL.revokeObjectURL(downloadURL);
    $("#directions_route_download").prop("href", "");
  };

  return routeOutput;
};
