export default function (map) {
  let marker;

  function clearMarker() {
    if (marker) marker.remove();
    marker = null;
  }

  function show(panToHome) {
    map.setSidebarOverlaid(true);
    clearMarker();

    if (OSM.home) {
      if (panToHome) {
        OSM.router.withoutMoveListener(function () {
          map.setView(OSM.home, 15, { reset: true });
        });
      }
      const homeLL = { lng: OSM.home.lon, lat: OSM.home.lat };
      marker = new OSM.MapLibre.Marker({ icon: "dot", color: "var(--marker-red)" })
        .setLngLat(homeLL)
        .addTo(map);
      marker.getElement().title = OSM.i18n.t("javascripts.home.marker_title");
    } else {
      $("#browse_status").html(
        $("<div class='m-2 alert alert-warning'>").text(
          OSM.i18n.t("javascripts.home.not_set")
        )
      );
    }
  }

  return {
    load() {
      show(true);
    },

    init() {
      show(!OSM.parseHash(location.hash).center);
    },

    unload() {
      clearMarker();
      $("#browse_status").empty();
    }
  };
}
