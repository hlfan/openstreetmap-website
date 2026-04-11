export default function (map) {
  const noteLayer = map.noteLayer,
        content = $("#sidebar_content"),
        page = {},
        control = $(".control-note"),
        addNoteButton = control.find(".control-button");
  let newNoteMarker,
      haloSourceId,
      errorPanel,
      errorPanelDetail;

  function createNote(location, text) {
    return fetch("/api/0.6/notes.json", {
      method: "POST",
      headers: { ...OSM.oauth },
      body: new URLSearchParams({
        lat: location.lat,
        lon: location.lng,
        text
      })
    })
      .then(resp => {
        if (resp.ok) return resp.json();
        throw new Error(`Got response with status ${resp.status} ${resp.statusText}`);
      });
  }

  function addHalo(latlng) {
    removeHalo();
    haloSourceId = "new-note-halo";
    const geojson = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [latlng.lng, latlng.lat] }
    };
    OSM.MapLibre.whenStyleReady(map, () => {
      OSM.MapLibre.addGeoJSONLayer(map, haloSourceId, geojson, {
        color: OSM.MapLibre.DATA_LAYER_STYLE.color,
        radius: 20,
        weight: 2.5,
        fillOpacity: 0.5,
        opacity: 1
      });
    });
  }

  function removeHalo() {
    if (haloSourceId) {
      OSM.MapLibre.removeGeoJSONLayer(map, haloSourceId);
      haloSourceId = null;
    }
  }

  function addNewNoteMarker(latlng) {
    if (newNoteMarker) newNoteMarker.remove();

    const markerOpts = OSM.noteMarkers.new;
    newNoteMarker = new OSM.MapLibre.Marker({ ...markerOpts, draggable: true })
      .setLngLat(latlng)
      .addTo(map);

    newNoteMarker.on("dragstart", function () {
      removeHalo();
    });

    newNoteMarker.on("dragend", function () {
      addHalo(newNoteMarker.getLngLat());
      content.find("textarea").trigger("focus");
    });

    addHalo(newNoteMarker.getLngLat());
  }

  function removeNewNoteMarker() {
    removeHalo();
    if (newNoteMarker) {
      newNoteMarker.getElement().classList.remove("opacity-50");
      newNoteMarker.remove();
    }
    newNoteMarker = null;
  }

  function moveNewNoteMarkerToClick(e) {
    if (newNoteMarker) newNoteMarker.setLngLat(e.lngLat);
    if (haloSourceId && map.getSource(haloSourceId)) {
      OSM.MapLibre.updateGeoJSONSource(map, haloSourceId, {
        type: "Feature",
        geometry: { type: "Point", coordinates: [e.lngLat.lng, e.lngLat.lat] }
      });
    }
    content.find("textarea").trigger("focus");
  }

  function updateControls() {
    const zoomedOut = addNoteButton.hasClass("disabled");
    const withoutText = content.find("textarea").val() === "";

    content.find("#new-note-zoom-warning").prop("hidden", !zoomedOut);
    content.find("input[type=submit]").prop("disabled", zoomedOut || withoutText);
    // Fade the draggable marker while the submit button is disabled by the
    // zoom threshold — mirrors the Leaflet marker.setOpacity(0.5) feedback
    // so the user sees that the marker won't submit at this zoom.
    if (newNoteMarker) {
      newNoteMarker.getElement().classList.toggle("opacity-50", zoomedOut);
    }
  }

  page.pushstate = page.popstate = function (path) {
    OSM.loadSidebarContent(path, function () {
      page.load(path);
    });
  };

  page.load = function (path) {
    control.addClass("active");

    map.addLayer(map.noteLayer);

    const params = new URLSearchParams(path.substring(path.indexOf("?")));
    let markerLatlng;

    if (params.has("lat") && params.has("lon")) {
      markerLatlng = { lat: parseFloat(params.get("lat")), lng: parseFloat(params.get("lon")) };
    } else {
      markerLatlng = map.getCenter();
    }

    map.panInside(markerLatlng, {
      padding: [50, 50]
    });

    addNewNoteMarker(markerLatlng);

    content.find("textarea")
      .on("input", updateControls)
      .attr("readonly", "readonly")
      .trigger("focus")
      .removeAttr("readonly");

    content.find("input[type=submit]").on("click", function (e) {
      const location = newNoteMarker.getLngLat().wrap();
      const text = content.find("textarea").val();

      errorPanel = content.find(".new-note-error");
      errorPanel.addClass("d-none");
      errorPanelDetail = errorPanel.find(".new-note-error-detail");

      e.preventDefault();
      $(this).prop("disabled", true);
      newNoteMarker.setDraggable(false);

      createNote(location, text)
        .then(feature => {
          if (typeof OSM.user === "undefined") {
            const anonymousNotesCount = Number(OSM.cookies.get("_osm_anonymous_notes_count")) || 0;
            OSM.cookies.set("_osm_anonymous_notes_count", anonymousNotesCount + 1, { expires: 14 });
          }
          content.find("textarea").val("");
          noteLayer.addNote(feature);
          OSM.router.route("/note/" + feature.properties.id);
        })
        .catch(err => {
          errorPanel.removeClass("d-none");
          errorPanelDetail.text(err.message || err);
          updateControls();
        });
    });

    map.on("click", moveNewNoteMarkerToClick);
    addNoteButton.on("disabled enabled", updateControls);
    updateControls();

    return map.getState();
  };

  page.unload = function () {
    map.off("click", moveNewNoteMarkerToClick);
    addNoteButton.off("disabled enabled", updateControls);
    removeNewNoteMarker();
    control.removeClass("active");
  };

  return page;
}
