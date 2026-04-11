OSM.MapLibre.CombinedControlGroup = class CombinedControlGroup {
  constructor(controls) {
    // array of MapLibre controls
    this.controls = controls;
    // DOM containers returned by onAdd()
    this.containers = [];
  }

  onAdd(map) {
    this._container = document.createElement("div");
    this._container.className = "maplibregl-ctrl maplibregl-ctrl-group";

    for (const ctrl of this.controls) {
      const ctrlContainer = ctrl.onAdd(map);
      this.containers.push(ctrlContainer);

      // Extract buttons from the control's container and add to our wrapper
      const buttons = ctrlContainer.querySelectorAll("button");
      const iconMap = {
        "zoom-in": "plus-lg",
        "zoom-out": "dash-lg",
        "geolocate": "cursor-fill"
      };

      buttons.forEach(button => {
      // Find the type of button (zoom-in, zoom-out, etc.) from its class name
        const match = button.className.match(/maplibregl-ctrl-([\w-]+)/);
        if (match) {
          const type = match[1]; // e.g., "zoom-in"
          const icon = iconMap[type];

          if (icon) {
            const iconElement = document.createElement("i");
            iconElement.className = `maplibregl-ctrl-icon fs-5 bi bi-${icon}`;
            button.replaceChildren(iconElement);
          }

          // Shift-click on zoom-in/out zooms by 3 levels, matching
          // Leaflet's zoomDelta-on-shift behavior.
          if (type === "zoom-in" || type === "zoom-out") {
            button.addEventListener("click", (e) => {
              if (!e.shiftKey) return;
              const delta = type === "zoom-in" ? 3 : -3;
              map.easeTo({ zoom: map.getZoom() + delta });
            });
          }
        }
        this._container.appendChild(button);
      });
    }

    return this._container;
  }

  onRemove() {
    for (const ctrl of this.controls) ctrl.onRemove?.();

    if (this._container) this._container.remove();
  }
};

OSM.MapLibre.GeolocateControl = class extends maplibregl.GeolocateControl {
  constructor({ positionOptions = {}, ...options } = {}) {
    super({
      positionOptions: {
        enableHighAccuracy: true,
        ...positionOptions
      },
      trackUserLocation: true,
      ...options
    });
  }

  onAdd(map) {
    this.setEventedParent(map);
    return super.onAdd(map);
  }
};

OSM.MapLibre.NavigationControl = class extends maplibregl.NavigationControl {
  constructor(options = {}) {
    super({
      showCompass: false,
      ...options
    });
  }
};
