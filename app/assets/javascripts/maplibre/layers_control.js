//= require @maptiler/maplibre-gl-omt-language
//= require maplibre/map
//= require maplibre/i18n

OSM.MapLibre.layers = function (options) {
  const control = OSM.MapLibre.sidebarPane(options, "layers", "javascripts.map.layers.title", "javascripts.map.layers.header");

  control.onAddPane = function (map, button, $ui, toggle) {
    const layers = map.baseLayers;

    control.onContentLoaded = function () {
      $ui.find(".base-layers>div").each(initBaseLayer);
      initOverlays();
    };
    control.loadContent();

    function initBaseLayer() {
      const [container, input, item] = this.children;
      const layer = layers.find(l => l.layerId === container.dataset.layer);
      input.checked = map.getMapBaseLayerId() === layer.layerId;

      function initMiniMap() {
        let miniMap;
        $ui
          .on("show", shown)
          .on("hide", hide);

        function shown() {
          const center = map.getCenter();
          try {
            miniMap = new OSM.MapLibre.Map({
              container,
              style: layer.style,
              interactive: false,
              attributionControl: false,
              fadeDuration: 0,
              zoomSnap: layer.isVectorStyle ? 0 : 1,
              center: [center.lng, center.lat],
              zoom: getZoomForMiniMap()
            });
          } catch {
            return;
          }

          if (layer.layerId === "openmaptiles_osm") {
            OSM.MapLibre.setOMTMapLanguage(miniMap);
          }

          map.on("moveend", moved);
        }

        function hide() {
          if (miniMap) {
            map.off("moveend", moved);
            miniMap.remove();
          }
        }

        function moved() {
          const center = map.getCenter();
          const zoom = getZoomForMiniMap();
          miniMap.easeTo({ center: [center.lng, center.lat], zoom });
        }

        function getZoomForMiniMap() {
          return Math.max(Math.floor(map.getZoom() - 3), -1);
        }
      }

      if (map.loaded()) {
        initMiniMap();
      } else {
        map.once("load", initMiniMap);
      }

      $(input).on("click", function () {
        map.updateLayers(layer.code);
      });

      $(item).on("dblclick", toggle);

      const onBaselayerChange = function () {
        input.checked = map.getMapBaseLayerId() === layer.layerId;
      };
      map.on("baselayerchange", onBaselayerChange);
      control.registerCleanup(() => map.off("baselayerchange", onBaselayerChange));
    }

    function initOverlays() {
      $ui.find(".overlay-layers div.form-check").each(function () {
        const item = this;
        const layer = map[this.dataset.layerId];
        const input = this.firstElementChild.firstElementChild;
        $(item).tooltip("disable");

        let checked = map.hasLayer(layer);

        input.checked = checked;

        $(input).on("change", function () {
          checked = input.checked;
          layer.cancelLoading?.();

          if (checked) {
            map.addLayer(layer);
          } else {
            map.removeLayer(layer);
            $(`#layers-${item.dataset.name}-loading`).remove();
          }
        });

        const updateChecked = function () {
          checked = map.hasLayer(layer);
          input.checked = checked;
        };
        map.on("overlayadd", updateChecked);
        map.on("overlayremove", updateChecked);

        const onZoomEnd = function () {
          const disabled = OSM.MapLibre.boundsSize(map.getBounds()) >= item.dataset.maxArea;
          input.disabled = disabled;

          if (disabled && input.checked) {
            input.click();
            checked = true;
          } else if (!disabled && !input.checked && checked) {
            input.click();
          }

          item.classList.toggle("disabled", disabled);
          $(item).tooltip(disabled ? "enable" : "disable");
        };
        map.on("zoomend", onZoomEnd);

        control.registerCleanup(() => {
          map.off("overlayadd", updateChecked);
          map.off("overlayremove", updateChecked);
          map.off("zoomend", onZoomEnd);
        });
      });
    }
  };

  return control;
};
