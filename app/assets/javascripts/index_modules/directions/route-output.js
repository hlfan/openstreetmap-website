/* exported RouteOutput */
function RouteOutput(map) {
  const popup = new OSM.MapLibre.Popup({ anchor: "bottom", offset: [0, -5] });

  const routeSourceId = "directions-route";
  const highlightSourceId = "directions-highlight";
  let currentRoute = null;

  class UnitFormatter {
    constructor(unitObj) {
      const units = Object.entries(unitObj).sort((a, b) => a[1] - b[1]);
      [[this.minorName, this.minorScale], [this.majorName, this.majorScale]] = units;
    }

    print(name, distance) {
      const scope = "javascripts.directions.distance_in_units";
      return OSM.i18n.t(name, { scope, distance });
    }

    totalDistance(m) {
      const minorValue = m / this.minorScale;
      const majorValue = m / this.majorScale;

      if (minorValue < 1000 || majorValue < 0.25) return this.print(this.minorName, Math.round(minorValue));
      if (majorValue < 10) return this.print(this.majorName, majorValue.toFixed(1));
      return this.print(this.majorName, Math.round(majorValue));
    }

    stepDistance(m) {
      const minorValue = m / this.minorScale;
      const majorValue = m / this.majorScale;

      if (minorValue < 5) return "";
      if (minorValue < 200) return this.print(this.minorName, Math.round(minorValue / 10) * 10);
      if (minorValue < 1500 || majorValue < 0.25) return this.print(this.minorName, Math.round(minorValue / 100) * 100);
      if (majorValue < 5) return this.print(this.majorName, majorValue.toFixed(1));
      return this.print(this.majorName, Math.round(majorValue));
    }

    height(m) {
      if (isNaN(m)) return "";
      const minorValue = m / this.minorScale;

      return this.print(this.minorName, Math.round(minorValue));
    }

    time(s) {
      let m = Math.round(s / 60);
      const h = Math.floor(m / 60);

      m -= h * 60;

      return h + ":" + (m < 10 ? "0" : "") + m;
    }
  }

  const FORMATTERS = {
    km_m: new UnitFormatter({ km: 1000, m: 1 }),
    mi_ft: new UnitFormatter({ mi: 1609.344, ft: 0.3048 }),
    mi_yd: new UnitFormatter({ mi: 1609.344, yd: 0.9144 })
  };
  let formatter = FORMATTERS.km_m;
  let downloadURL = null;

  function writeTable({ distance, time, ascend, descend, steps }) {
    $("#directions_route_distance").val(formatter.totalDistance(distance));
    $("#directions_route_time").val(formatter.time(time));

    $("#directions_route_ascend_descend").prop("hidden", isNaN(ascend) || isNaN(descend));
    $("#directions_route_ascend").val(formatter.height(ascend));
    $("#directions_route_descend").val(formatter.height(descend));

    $("#directions_route_steps").empty().append(...steps.map(stepToRow));
  }

  function stepToRow([direction, instruction, dist, lineseg], i) {
    const popupText = `<b>${i + 1}.</b> ${instruction}`;
    let icon = "";
    if (direction) icon = `<svg width="20" height="20" class="d-block"><use href="#routing-sprite-${direction}" /></svg>`;

    return $("<tr class='turn'/>")
      .append(`<td class='ps-3'>${icon}</td>`)
      .append(`<td class="text-break">${popupText}</td>`)
      .append(`<td class="pe-3 distance text-body-secondary text-end">${formatter.stepDistance(dist)}</td>`)
      .on("click", () => {
        popup
          .setLngLat(lineseg[0])
          .setHTML(`<p>${popupText}</p>`)
          .addTo(map);
        map.panInside(lineseg[0], { padding: [100, 100] });
      })
      .on("mouseenter", () => {
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
      .on("mouseleave", () => OSM.MapLibre.removeGeoJSONLayer(map, highlightSourceId));
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
  map._overlayRestorers?.set(routeSourceId, restoreRouteOnStyleLoad);

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

    writeTable(route);

    $("#directions_distance_units_settings input").off().on("change", function () {
      formatter = FORMATTERS[this.value] || FORMATTERS.km_m;
      writeTable(route);
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
    map._overlayRestorers?.delete(routeSourceId);
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
