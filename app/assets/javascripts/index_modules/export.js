//= require download_util

export default function (map) {
  const page = {};

  const locationFilter = new OSM.MapLibre.LocationFilter();
  locationFilter.on("change", update);

  function getBounds() {
    return new maplibregl.LngLatBounds(
      [parseFloat($("#minlon").val()), parseFloat($("#minlat").val())],
      [parseFloat($("#maxlon").val()), parseFloat($("#maxlat").val())]
    );
  }

  function boundsChanged() {
    const bounds = getBounds();
    map.fitBounds(bounds);
    locationFilter.setBounds(bounds);
    locationFilter.enable();
    validateControls();
  }

  function enableFilter(e) {
    e.preventDefault();

    $("#drag_box").hide();

    locationFilter.setBounds(OSM.MapLibre.padBounds(map.getBounds(), -0.2));
    locationFilter.enable();
    validateControls();
  }

  function update() {
    setBounds(locationFilter.isEnabled() ? locationFilter.getBounds() : map.getBounds());
    validateControls();
  }

  async function showConfirmationModal() {
    const $modal = $("#export_confirmation");
    const $downloadButton = $modal.find("[data-action=\"download\"]");
    $modal.appendTo("body").modal("show");

    return new Promise(resolve => {
      const onOkClick = () => {
        resolve(true);
        $modal.modal("hide");
      };

      const onModalHidden = () => {
        $downloadButton.off("click", onOkClick);
        $modal.off("hidden.bs.modal", onModalHidden);
        resolve(false);
      };

      $downloadButton.on("click", onOkClick);
      $modal.on("hidden.bs.modal", onModalHidden);
    });
  }

  function setBounds(bounds) {
    const zoom = map.getZoom() + OSM.ZOOM_OFFSET;
    const sw = OSM.cropLocation(bounds.getSouthWest(), zoom);
    $("#minlon").val(sw.lng);
    $("#minlat").val(sw.lat);
    const ne = OSM.cropLocation(bounds.getNorthEast(), zoom);
    $("#maxlon").val(ne.lng);
    $("#maxlat").val(ne.lat);

    $("#export_overpass").attr("href",
                               `https://overpass-api.de/api/map?bbox=${sw.lng},${sw.lat},${ne.lng},${ne.lat}`);
  }

  function validateControls() {
    const bounds = getBounds();
    const boundsSize = OSM.MapLibre.boundsSize(bounds);
    $("#export_osm_too_large").toggle(boundsSize > OSM.MAX_REQUEST_AREA);
    $("#export_commit").toggle(boundsSize < OSM.MAX_REQUEST_AREA);
  }

  function checkSubmit(e) {
    if (OSM.MapLibre.boundsSize(getBounds()) > OSM.MAX_REQUEST_AREA) e.preventDefault();
  }

  page.pushstate = page.popstate = function (path) {
    OSM.loadSidebarContent(path, page.load);
  };

  page.load = function () {
    locationFilter.addTo(map);
    map.on("moveend", update);

    $("#maxlat, #minlon, #maxlon, #minlat").change(boundsChanged);
    $("#drag_box").click(enableFilter);
    $(".export_form").on("submit", checkSubmit);

    document.querySelector(".export_form")
      .addEventListener("turbo:submit-end", OSM.getTurboBlobHandler("map.osm"));

    document.querySelector(".export_form")
      .addEventListener("turbo:before-fetch-response", OSM.turboHtmlResponseHandler);

    document.querySelector(".export_form")
      .addEventListener("turbo:before-fetch-request", function (event) {
        event.detail.fetchOptions.headers.Accept = "application/xml";
      });

    $("#export_overpass").on("click", async function (event) {
      event.preventDefault();
      const downloadUrl = $(this).attr("href");
      const confirmed = await showConfirmationModal();
      if (confirmed) {
        window.location.href = downloadUrl;
      }
    });

    update();
    return map.getState();
  };

  page.unload = function () {
    locationFilter.remove();
    map.off("moveend", update);
  };

  return page;
}
