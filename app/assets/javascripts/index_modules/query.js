//= require feature_label

export default function (map) {
  const uninterestingTags = ["source", "source_ref", "source:ref", "history", "attribution", "created_by", "tiger:county", "tiger:tlid", "tiger:upload_uuid", "KSJ2:curve_id", "KSJ2:lat", "KSJ2:lon", "KSJ2:coordinate", "KSJ2:filename", "note:ja"];
  let markerSourceId;
  const geometryLayers = [];

  const featureStyle = {
    color: "#FF6200",
    weight: 4,
    opacity: 1,
    fillOpacity: 0.5
  };

  function showResultGeometry() {
    const geometry = $(this).data("geometry");
    if (geometry) {
      const id = "query-geom-" + geometryLayers.length;
      geometryLayers.push(id);
      $(this).data("geometryId", id);
      OSM.MapLibre.whenStyleReady(map, () => {
        OSM.MapLibre.addGeoJSONLayer(map, id, geometry, featureStyle);
      });
    }
    $(this).addClass("selected");
  }

  function hideResultGeometry() {
    const id = $(this).data("geometryId");
    if (id) {
      OSM.MapLibre.removeGeoJSONLayer(map, id);
      const idx = geometryLayers.indexOf(id);
      if (idx >= 0) geometryLayers.splice(idx, 1);
    }
    $(this).removeClass("selected");
  }

  $("#sidebar_content")
    .on("mouseover", ".query-results a", showResultGeometry)
    .on("mouseout", ".query-results a", hideResultGeometry);

  function interestingFeature(feature) {
    if (feature.tags) {
      for (const key in feature.tags) {
        if (uninterestingTags.indexOf(key) < 0) {
          return true;
        }
      }
    }

    return false;
  }

  function featureGeometry(feature) {
    switch (feature.type) {
      case "node":
        if (!feature.lat || !feature.lon) return;
        return {
          type: "Feature",
          geometry: { type: "Point", coordinates: [feature.lon, feature.lat] }
        };
      case "way":
        if (!feature.geometry?.length) return;
        return {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: feature.geometry.filter(p => p).map(p => [p.lon, p.lat])
          }
        };
      case "relation":
        if (!feature.members?.length) return;
        {
          const memberGeoms = feature.members.map(featureGeometry).filter(g => g);
          if (memberGeoms.length === 0) return;
          return {
            type: "FeatureCollection",
            features: memberGeoms
          };
        }
    }
  }

  function runQuery(query, $section, merge, compare) {
    const $ul = $section.find("ul");

    $ul.empty();
    $section.show();

    if ($section.data("ajax")) {
      $section.data("ajax").abort();
    }

    $section.data("ajax", new AbortController());
    fetch(OSM.OVERPASS_URL, {
      method: "POST",
      body: new URLSearchParams({
        data: "[timeout:10][out:json];" + query
      }),
      credentials: OSM.OVERPASS_CREDENTIALS ? "include" : "same-origin",
      signal: $section.data("ajax").signal
    })
      .then(response => {
        if (response.ok) {
          return response.json();
        }
        throw new Error(response.statusText || response.status);
      })
      .then(function (results) {
        let elements = results.elements;

        $section.find(".loader").hide();

        for (const element of elements) {
          if (!element.bounds) continue;
          if (element.bounds.maxlon >= element.bounds.minlon) continue;
          element.bounds.maxlon += 360;
        }

        if (merge) {
          elements = Object.values(elements.reduce(function (hash, element) {
            const key = element.type + element.id;
            if ("geometry" in element) delete element.bounds;
            hash[key] = { ...hash[key], ...element };
            return hash;
          }, {}));
        }

        if (compare) {
          elements = elements.sort(compare);
        }

        for (const element of elements) {
          if (!interestingFeature(element)) continue;

          const $li = $("<li>")
            .addClass("list-group-item list-group-item-action")
            .text(OSM.featurePrefix(element) + " ")
            .appendTo($ul);

          $("<a>")
            .addClass("stretched-link")
            .attr("href", "/" + element.type + "/" + element.id)
            .data("geometry", featureGeometry(element))
            .text(OSM.featureName(element))
            .appendTo($li);
        }

        if (results.remark) renderError($ul, results.remark);

        if ($ul.find("li").length === 0) {
          $("<li>")
            .addClass("list-group-item")
            .text(OSM.i18n.t("javascripts.query.nothing_found"))
            .appendTo($ul);
        }
      })
      .catch(function (error) {
        if (error.name === "AbortError") return;

        $section.find(".loader").hide();

        renderError($ul, error.message);
      });
  }

  function renderError($ul, errorMessage) {
    $("<li>")
      .addClass("list-group-item")
      .text(OSM.i18n.t("javascripts.query.error", { server: OSM.OVERPASS_URL, error: errorMessage }))
      .appendTo($ul);
  }

  function size({ maxlon, minlon, maxlat, minlat }) {
    return (maxlon - minlon) * (maxlat - minlat);
  }

  function queryOverpass(latlng) {
    const { lng, lat } = latlng,
          bounds = map.getBounds(),
          zoom = map.getZoom() + OSM.ZOOM_OFFSET,
          sw = OSM.cropLocation(bounds.getSouthWest(), zoom),
          ne = OSM.cropLocation(bounds.getNorthEast(), zoom),
          geom = `geom(${sw.lat},${sw.lng},${ne.lat},${ne.lng})`,
          radius = 10 * Math.pow(1.5, 19 - zoom),
          here = `(around:${radius},${lat},${lng})`,
          enclosed = "(pivot.a);out tags bb",
          nearby = `(node${here};way${here};);out tags ${geom};relation${here};out ${geom};`,
          isin = `is_in(${lat},${lng})->.a;way${enclosed};out ids ${geom};relation${enclosed};`;

    $("#sidebar_content .query-intro").hide();

    removeMarker();
    markerSourceId = "query-marker";
    const circleGeoJSON = OSM.MapLibre.circleGeoJSON(latlng, radius);
    OSM.MapLibre.whenStyleReady(map, () => {
      OSM.MapLibre.addGeoJSONLayer(map, markerSourceId, circleGeoJSON, featureStyle);
    });

    runQuery(nearby, $("#query-nearby"), false);
    runQuery(isin, $("#query-isin"), true, (feature1, feature2) => size(feature1.bounds) - size(feature2.bounds));
  }

  function removeMarker() {
    if (markerSourceId) {
      OSM.MapLibre.removeGeoJSONLayer(map, markerSourceId);
      markerSourceId = null;
    }
  }

  const page = {};

  page.pushstate = page.popstate = function (path) {
    OSM.loadSidebarContent(path, function () {
      page.load(path, true);
    });
  };

  page.load = function (path, noCentre) {
    const params = new URLSearchParams(path.substring(path.indexOf("?"))),
          latlng = { lng: parseFloat(params.get("lon")), lat: parseFloat(params.get("lat")) };

    if (!location.hash && !noCentre && !map.getBounds().contains([latlng.lng, latlng.lat])) {
      OSM.router.withoutMoveListener(function () {
        map.setView(latlng, 15);
      });
    }

    queryOverpass(latlng);
  };

  page.unload = function (sameController) {
    if (!sameController) {
      $("#sidebar_content .query-results a.selected").each(hideResultGeometry);
    }
    removeMarker();
  };

  return page;
}
