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

OSM.MapLibre.GeolocateControl = class extends maplibregl.Evented {
  constructor({ positionOptions = {}, fitBoundsOptions = { maxZoom: 15 },
    trackUserLocation = true, showUserLocation = true, showAccuracyCircle = true } = {}) {
    super();
    this.positionOptions = { enableHighAccuracy: true, ...positionOptions };
    this.fitBoundsOptions = fitBoundsOptions;
    this.trackUserLocation = trackUserLocation;
    this.showUserLocation = showUserLocation;
    this.showAccuracyCircle = showAccuracyCircle;
    this.generation = 0;
    this.watch = null;
    this.active = false;
    this.following = false;
    this.handleMapUpdate = () => this.updateAccuracyCircle();
    this.handleResize = () => {
      const canvas = this.map.getCanvas();
      this.canvasSize = [canvas.clientWidth, canvas.clientHeight];
    };
    this.handleMove = event => {
      const canvas = this.map.getCanvas();
      // Automatic map resizes emit movestart after changing the canvas dimensions.
      if (canvas.clientWidth !== this.canvasSize[0] || canvas.clientHeight !== this.canvasSize[1]) return;
      if (this.active && this.following && this.locationLocked && !this.locationError &&
          !event.osmLocationCamera && !this.map.isZooming()) {
        this.following = false;
        this.button.classList.remove("maplibregl-ctrl-geolocate-active");
        this.button.classList.add("maplibregl-ctrl-geolocate-background");
        this.fire(new maplibregl.Event("trackuserlocationend"));
        this.fire(new maplibregl.Event("userlocationlostfocus"));
      }
    };
  }

  onAdd(map) {
    this.map = map;
    this.handleResize();
    this.setEventedParent(map);
    this.container = document.createElement("div");
    this.container.className = "maplibregl-ctrl maplibregl-ctrl-group";
    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "maplibregl-ctrl-geolocate";
    this.button.disabled = true;
    if (this.trackUserLocation) this.button.setAttribute("aria-pressed", "false");
    const icon = document.createElement("span");
    icon.className = "maplibregl-ctrl-icon";
    icon.setAttribute("aria-hidden", "true");
    this.button.appendChild(icon);
    this.container.appendChild(this.button);
    const label = OSM.i18n.t("javascripts.map.GeolocateControl.FindMyLocation");
    this.button.title = label;
    this.button.setAttribute("aria-label", label);
    this.button.addEventListener("click", () => this.trigger());
    this.map.on("movestart", this.handleMove);
    this.map.on("resize", this.handleResize);
    for (const event of ["zoom", "move", "rotate", "pitch"]) this.map.on(event, this.handleMapUpdate);
    if (this.showUserLocation) {
      this.dot = document.createElement("div");
      this.dot.className = "maplibregl-user-location-dot";
      this.dotMarker = new maplibregl.Marker({ element: this.dot });
      if (this.showAccuracyCircle) {
        this.circle = document.createElement("div");
        this.circle.className = "maplibregl-user-location-accuracy-circle";
        this.circleMarker = new maplibregl.Marker({ element: this.circle, pitchAlignment: "map" });
      }
    }
    const button = this.button;
    const support = navigator.permissions ? Promise.resolve().then(() =>
      navigator.permissions.query({ name: "geolocation" })).then(
      permission => Boolean(navigator.geolocation) && permission.state !== "denied", () => Boolean(navigator.geolocation)) :
      Promise.resolve(Boolean(navigator.geolocation));
    support.then(available => {
      if (this.map !== map || this.button !== button) return;
      button.disabled = !available;
      if (!available) this.setUnavailableLabel();
    });
    return this.container;
  }

  trigger() {
    if (!this.map || this.button.disabled) return false;
    if (this.trackUserLocation && this.active) {
      this.stop();
    } else if (this.trackUserLocation) {
      this.active = this.following = true;
      this.locationLocked = false;
      this.locationError = false;
      this.button.setAttribute("aria-pressed", "true");
      this.button.classList.add("maplibregl-ctrl-geolocate-active", "maplibregl-ctrl-geolocate-waiting");
      const generation = ++this.generation;
      this.fire(new maplibregl.Event("trackuserlocationstart"));
      if (!this.map || !this.active || generation !== this.generation) return true;
      this.watch = navigator.geolocation.watchPosition(
        position => this.positionReceived(position, generation),
        error => this.positionError(error, generation), this.positionOptions);
    } else {
      const generation = ++this.generation;
      navigator.geolocation.getCurrentPosition(
        position => this.positionReceived(position, generation),
        error => this.positionError(error, generation), this.positionOptions);
    }
    return true;
  }

  setUnavailableLabel() {
    const label = OSM.i18n.t("javascripts.map.GeolocateControl.LocationNotAvailable");
    this.button.title = label;
    this.button.setAttribute("aria-label", label);
  }

  removeMarkers() {
    this.dotMarker?.remove();
    this.circleMarker?.remove();
  }

  updateAccuracyCircle() {
    if (!this.circleMarker || !this.position || !this.map) return;
    const point = new maplibregl.LngLat(this.position.coords.longitude, this.position.coords.latitude);
    const pixel = this.map.project(point);
    const metresPerPixel = point.distanceTo(this.map.unproject([pixel.x + 100, pixel.y])) / 100;
    if (metresPerPixel > 0) {
      const diameter = 2 * this.position.coords.accuracy / metresPerPixel;
      this.circle.style.width = `${diameter.toFixed(2)}px`;
      this.circle.style.height = `${diameter.toFixed(2)}px`;
    }
  }

  positionReceived(position, generation) {
    if (!this.map || generation !== this.generation || (this.trackUserLocation && !this.active)) return;
    const { longitude, latitude, accuracy } = position.coords;
    const point = new maplibregl.LngLat(longitude, latitude);
    const maxBounds = this.map.getMaxBounds();
    if (maxBounds && (longitude < maxBounds.getWest() || longitude > maxBounds.getEast() ||
                      latitude < maxBounds.getSouth() || latitude > maxBounds.getNorth())) {
      this.setErrorAppearance();
      this.removeMarkers();
      this.fire(new maplibregl.Event("outofmaxbounds", { coords: position.coords, timestamp: position.timestamp }));
      return;
    }
    this.position = position;
    this.locationLocked = true;
    this.locationError = false;
    this.button.classList.remove("maplibregl-ctrl-geolocate-waiting",
                                 "maplibregl-ctrl-geolocate-active-error", "maplibregl-ctrl-geolocate-background-error");
    if (this.trackUserLocation) {
      this.button.classList.toggle("maplibregl-ctrl-geolocate-active", this.following);
      this.button.classList.toggle("maplibregl-ctrl-geolocate-background", !this.following);
    }
    if (this.dotMarker) {
      this.dot.classList.remove("maplibregl-user-location-dot-stale");
      this.dotMarker.setLngLat(point).addTo(this.map);
      this.circleMarker?.setLngLat(point).addTo(this.map);
      this.updateAccuracyCircle();
    }
    if (!this.trackUserLocation || this.following) {
      const bounds = maplibregl.LngLatBounds.fromLngLat(point, accuracy);
      // Preserve MapLibre's camera-event tag while identifying this control's own moves.
      this.map.fitBounds(bounds, { bearing: this.map.getBearing(), ...this.fitBoundsOptions },
                         { osmLocationCamera: true, geolocateSource: true });
    }
    this.fire(new maplibregl.Event("geolocate", { coords: position.coords, timestamp: position.timestamp }));
  }

  setErrorAppearance() {
    if (!this.trackUserLocation || !this.active) return;
    this.locationError = true;
    this.button.classList.remove("maplibregl-ctrl-geolocate-active", "maplibregl-ctrl-geolocate-background");
    this.button.classList.add("maplibregl-ctrl-geolocate-waiting");
    this.button.classList.add(this.following ? "maplibregl-ctrl-geolocate-active-error" :
      "maplibregl-ctrl-geolocate-background-error");
  }

  positionError(error, generation) {
    if (!this.map || generation !== this.generation || (this.trackUserLocation && !this.active)) return;
    if (error.code === 1) {
      if (this.active) this.stop(false);
      this.button.disabled = true;
      this.setUnavailableLabel();
    } else {
      this.setErrorAppearance();
      if (this.active && this.dot) this.dot.classList.add("maplibregl-user-location-dot-stale");
    }
    this.fire(new maplibregl.Event("error", { code: error.code, message: error.message }));
  }

  stop(emit = true) {
    const wasFollowing = this.following;
    ++this.generation;
    this.active = false;
    this.following = false;
    this.locationLocked = false;
    this.locationError = false;
    if (this.watch !== null) navigator.geolocation.clearWatch(this.watch);
    this.watch = null;
    this.button.setAttribute("aria-pressed", "false");
    this.button.classList.remove("maplibregl-ctrl-geolocate-active", "maplibregl-ctrl-geolocate-background",
                                 "maplibregl-ctrl-geolocate-waiting", "maplibregl-ctrl-geolocate-active-error", "maplibregl-ctrl-geolocate-background-error");
    this.removeMarkers();
    if (emit && wasFollowing) this.fire(new maplibregl.Event("trackuserlocationend"));
  }

  onRemove() {
    if (this.active) this.stop(false);
    ++this.generation;
    this.removeMarkers();
    this.map.off("movestart", this.handleMove);
    this.map.off("resize", this.handleResize);
    for (const event of ["zoom", "move", "rotate", "pitch"]) this.map.off(event, this.handleMapUpdate);
    this.setEventedParent(null);
    this.container.remove();
    this.map = null;
  }
};

OSM.MapLibre.NavigationControl = class extends maplibregl.NavigationControl {
  constructor(options = {}) {
    super({
      showCompass: false,
      ...options
    });

    this._updateZoomButtons = () => {
      const zoom = this._map.getZoom() - OSM.ZOOM_OFFSET;
      const isMax = zoom === this._map.getMaxZoom();
      const isMin = zoom === this._map.getMinZoom();
      this._zoomInButton.disabled = isMax;
      this._zoomOutButton.disabled = isMin;
      this._zoomInButton.setAttribute("aria-disabled", isMax.toString());
      this._zoomOutButton.setAttribute("aria-disabled", isMin.toString());
    };
  }
};
