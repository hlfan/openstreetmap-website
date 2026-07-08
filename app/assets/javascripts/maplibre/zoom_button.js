OSM.MapLibre.zoomButton = function ({ uiClass, icon, titleKey, disabledTitleKey, minZoom, extraDisabled }) {
  const control = {};
  let updateHandler = null;

  control.onAdd = function (map) {
    const $container = $("<div>").attr("class", "control-" + uiClass);

    // Use aria-label for the stable accessible name (which Capybara's
    // `find_link` matches on and screen readers announce), so the `title`
    // attribute is free to carry the dynamic disabled/enabled tooltip text.
    const link = $("<a>")
      .attr("class", "control-button")
      .attr("href", "#")
      .attr("aria-label", OSM.i18n.t(titleKey))
      .append($("<i>").addClass("fs-5 bi bi-" + icon))
      .appendTo($container);

    updateHandler = function () {
      const wasDisabled = link.hasClass("disabled"),
            isDisabled = (extraDisabled && extraDisabled()) || map.getZoom() + OSM.ZOOM_OFFSET < minZoom;
      const title = OSM.i18n.t(isDisabled ? disabledTitleKey : titleKey);
      link.toggleClass("disabled", isDisabled);
      OSM.MapLibre.setButtonTitle(link, title);
      if (isDisabled === wasDisabled) return;
      link.trigger(isDisabled ? "disabled" : "enabled");
    };

    map.on("zoomend", updateHandler);
    updateHandler();

    control._map = map;

    const wrapper = document.createElement("div");
    wrapper.className = "maplibregl-ctrl";
    wrapper.appendChild($container[0]);
    control._container = wrapper;
    return wrapper;
  };

  control.onRemove = function () {
    if (control._map && updateHandler) {
      control._map.off("zoomend", updateHandler);
    }
    updateHandler = null;
    control._map = null;
    if (control._container) control._container.remove();
  };

  control.getContainer = function () {
    return control._container;
  };

  return control;
};
