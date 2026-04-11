//= require maplibre/controls
//= require maplibre/dom_util

maplibregl.Map.prototype._getUIString = function (key) {
  const snakeCaseKey = key.replaceAll(/(?<=\w)[A-Z]/g, "_$&").toLowerCase();
  return OSM.i18n.t(`javascripts.map.${snakeCaseKey}`);
};

// MODULE_PATHS is absent in the embed bundle, which doesn't need the RTL text plugin.
// The status check avoids calling setRTLTextPlugin twice when a page loads multiple
// bundles that require this file.
if (OSM.MODULE_PATHS && maplibregl.getRTLTextPluginStatus() === "unavailable") {
  maplibregl.setRTLTextPlugin(OSM.MODULE_PATHS.mapbox_rtl_text, true);
}

OSM.MapLibre.showWebGLError = function (container) {
  const containerElement =
    typeof container === "string" ? document.getElementById(container) : container;

  if (containerElement) {
    fetch("/panes/webgl_error")
      .then(response => response.text())
      .then(html => containerElement.innerHTML = html);
  }
};

OSM.MapLibre.setButtonTitle = function ($button, title) {
  $button.attr("title", title);
  $button.attr("data-bs-original-title", title);
  const tooltipInstance = window.bootstrap?.Tooltip.getInstance($button[0]);
  if (tooltipInstance) {
    tooltipInstance.setContent({ ".tooltip-inner": title });
  }
};

OSM.MapLibre.styleForLayer = function (layer) {
  return (OSM.isDark("map") && layer.styleDark) || layer.style;
};

OSM.MapLibre.Map = class extends maplibregl.Map {
  constructor({ allowRotation, ...options } = {}) {
    const rotationOptions = {};
    if (allowRotation === false) {
      Object.assign(rotationOptions, {
        rollEnabled: false,
        dragRotate: false,
        pitchWithRotate: false,
        bearingSnap: 180
      });
    }

    let map;
    try {
      map = super({
        // Style validation only affects debug output.
        // Style errors are usually reported to authors, who should validate the style in CI for better error messages.
        validateStyle: false,
        attributionControl: false,
        ...rotationOptions,
        ...options
      });
    } catch (error) {
      const structuredError = JSON.parse(error.message);
      if (structuredError.type === "webglcontextcreationerror") {
        OSM.MapLibre.showWebGLError(options.container);
      }
      // the constructor panicked => we need to re-throw
      throw error;
    }
    if (allowRotation === false) {
      map.touchZoomRotate.disableRotation();
      map.keyboard.disableRotation();
    }
    return map;
  }

  // isStyleLoaded() aggregates tile and image loading, so it flips back to false
  // after style.load fires and can't tell us whether the style document itself is
  // ready. The style's own _loaded flag is the latch we want: true once style.load
  // has fired for the current style, reset when setStyle() swaps in a new one.
  onceStyleReady(fn) {
    if (this.style?._loaded) {
      fn();
      return;
    }
    this.once("style.load", fn);
  }
};

OSM.MapLibre.SecondaryMap = class extends OSM.MapLibre.Map {
  constructor(options = {}) {
    const defaultHomeZoom = 11;
    super({
      container: "map",
      style: OSM.LAYER_DEFINITIONS[0].style,
      allowRotation: false,
      maxPitch: 0,
      center: OSM.home ? [OSM.home.lon, OSM.home.lat] : [0, 0],
      zoom: OSM.home ? defaultHomeZoom : 0,
      zoomSnap: 1.0,
      ...options
    });
  }
};
