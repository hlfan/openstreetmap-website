OSM.MapLibre.sidebarPane = function (options, uiClass, buttonTitle, paneTitle) {
  const control = {};
  const cleanupFns = [];

  control.registerCleanup = function (fn) {
    cleanupFns.push(fn);
  };

  control.onAdd = function (map) {
    const $container = $("<div>")
      .attr("class", "control-" + uiClass);

    const button = $("<a>")
      .attr("class", "control-button")
      .attr("href", "#")
      .attr("aria-label", OSM.i18n.t(buttonTitle))
      .attr("title", OSM.i18n.t(buttonTitle))
      .on("click", toggle);

    const iconMap = {
      layers: "stack",
      legend: "info-lg",
      share: "share-fill"
    };
    const iconName = iconMap[uiClass] || uiClass;
    $("<i>").addClass("fs-5 bi bi-" + iconName).appendTo(button);
    button.appendTo($container);

    const $ui = $("<div>")
      .attr("class", `${uiClass}-ui position-relative z-n1`);

    $("<h2 class='p-3 pb-0 pe-5 text-break'>")
      .text(OSM.i18n.t(paneTitle))
      .appendTo($ui);

    options.sidebar.addPane($ui);

    control.loadContent = () =>
      fetch("/panes/" + uiClass)
        .then(r => {
          if (!r.ok) throw new Error(r.statusText || r.status);
          return r.text();
        })
        .then(html => { $(html).appendTo($ui); })
        .then(control.onContentLoaded)
        .catch(() => {
          $("<p class='alert alert-warning m-3'>")
            .text(OSM.i18n.t("javascripts.pane_load_error"))
            .appendTo($ui);
        });

    control.onAddPane(map, button, $ui, toggle);

    function toggle(e) {
      e.stopPropagation();
      e.preventDefault();
      if (!button.hasClass("disabled")) {
        options.sidebar.togglePane($ui, button);
      }
      $(".maplibregl-ctrl .control-button, .control-button").tooltip("hide");
    }

    const wrapper = document.createElement("div");
    wrapper.className = "maplibregl-ctrl";
    wrapper.appendChild($container[0]);
    control._container = wrapper;

    return wrapper;
  };

  control.onRemove = function () {
    while (cleanupFns.length) {
      cleanupFns.pop()();
    }
    if (control._container) control._container.remove();
  };

  control.getContainer = function () {
    return control._container;
  };

  return control;
};
