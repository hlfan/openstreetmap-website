export default function (map) {
  let marker;

  function clearMarker() {
    if (marker) marker.remove();
    marker = null;
  }

  const page = {};

  page.pushstate = page.popstate = page.load = function () {
    map.setSidebarOverlaid(true);
    clearMarker();

    if (OSM.home) {
      OSM.router.withoutMoveListener(function () {
        map.setView(OSM.home, 15, { reset: true });
      });
      marker = new OSM.MapLibre.Marker({ icon: "dot", color: "var(--marker-red)" })
        .setLngLat([OSM.home.lon, OSM.home.lat])
        .addTo(map);
      marker.getElement().title = OSM.i18n.t("javascripts.home.marker_title");
    } else {
      $("#browse_status").html(
        $("<div class='m-2 alert alert-warning'>").text(
          OSM.i18n.t("javascripts.home.not_set")
        )
      );
    }
  };

  page.unload = function () {
    clearMarker();
    $("#browse_status").empty();
  };

  return page;
}
