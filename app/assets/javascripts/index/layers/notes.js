OSM.initializeNotesLayer = function (map) {
  let noteLoader;
  const noteLayer = map.noteLayer;
  let notes = {};

  noteLayer.on("add", () => {
    loadNotes();
    map.on("moveend", loadNotes);
    map.fire("overlayadd", { layer: noteLayer });
  });
  noteLayer.on("remove", () => {
    if (noteLoader) noteLoader.abort();
    noteLoader = null;
    map.off("moveend", loadNotes);
    for (const id in notes) {
      notes[id].remove();
    }
    notes = {};
    noteLayer._markers = {};
    map.fire("overlayremove", { layer: noteLayer });
  });

  function updateMarker(old_marker, feature) {
    let marker = old_marker;
    const coords = feature.geometry.coordinates;
    const status = feature.properties.status;

    if (marker) {
      const el = marker.getElement();
      const use = el.querySelector("use[href^='#pin-']");
      if (use) {
        const markerDef = OSM.noteMarkers[status];
        use.setAttribute("href", `#pin-${markerDef.icon}`);
        use.setAttribute("color", markerDef.color);
      }
    } else {
      let title;
      const description = feature.properties.comments[0];

      if (description?.action === "opened") {
        title = description.text;
      }

      const markerOpts = OSM.noteMarkers[status];
      marker = new OSM.MapLibre.Marker({ ...markerOpts })
        .setLngLat([coords[0], coords[1]])
        .addTo(map);

      if (title) {
        marker.getElement().title = title;
      }

      marker.id = feature.properties.id;
      marker.getElement().style.cursor = "pointer";
      marker.getElement().addEventListener("click", function (e) {
        if (marker.id) {
          OSM.router.click(e, "/note/" + marker.id);
        }
      });
    }
    return marker;
  }

  noteLayer.addNote = function (feature) {
    const id = feature.properties.id;
    notes[id] = updateMarker(notes[id], feature);
    noteLayer._markers = notes;
    return notes[id];
  };

  function loadNotes() {
    const bounds = map.getBounds();
    const size = OSM.MapLibre.boundsSize(bounds);

    if (size <= OSM.MAX_NOTE_REQUEST_AREA) {
      const url = "/api/" + OSM.API_VERSION + "/notes.json?bbox=" + OSM.MapLibre.boundsToBBoxString(bounds);

      if (noteLoader) noteLoader.abort();

      noteLoader = new AbortController();
      fetch(url, { signal: noteLoader.signal })
        .then(response => response.json())
        .then(success)
        .catch(() => {})
        .finally(() => noteLoader = null);
    }

    function success(json) {
      const oldNotes = notes;
      notes = {};
      for (const feature of json.features) {
        const marker = oldNotes[feature.properties.id];
        delete oldNotes[feature.properties.id];
        notes[feature.properties.id] = updateMarker(marker, feature);
      }

      for (const id in oldNotes) {
        oldNotes[id].remove();
      }

      noteLayer._markers = notes;
    }
  }
};
