OSM.MapLibre.legend = function (options) {
  const control = OSM.MapLibre.sidebarPane(options, "legend", "javascripts.legend.title", "javascripts.legend.title");

  control.onAddPane = function (map, button, $ui) {
    $ui
      .on("show", () => {
        map.on("zoomend", update);
        update();
      })
      .on("hide", () => {
        map.off("zoomend", update);
      });

    map.on("baselayerchange", updateButton);
    control.registerCleanup(() => {
      map.off("zoomend", update);
      map.off("baselayerchange", updateButton);
    });

    updateButton();

    control.onContentLoaded = update;
    $ui.one("show", control.loadContent);

    function updateButton() {
      const disabled = !map.getMapBaseLayer().hasLegend;
      const title = OSM.i18n.t(disabled ?
        "javascripts.legend.tooltip_disabled" :
        "javascripts.legend.tooltip");
      button.toggleClass("disabled", disabled);
      OSM.MapLibre.setButtonTitle(button, title);
    }

    function update() {
      const layerId = map.getMapBaseLayerId(),
            zoom = map.getZoom() + OSM.ZOOM_OFFSET;

      $("#legend [data-layer]").each(function () {
        const data = $(this).data();
        $(this).toggle(
          layerId === data.layer &&
          (!data.zoomMin || zoom >= data.zoomMin) &&
          (!data.zoomMax || zoom <= data.zoomMax)
        );
      });
    }
  };

  return control;
};
