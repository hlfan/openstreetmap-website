OSM.MapLibre.DATA_LAYER_STYLE = {
  color: "#FF6200",
  hoverColor: "#FF9500",
  casingColorLight: "#FFFFFF",
  casingColorDark: "#000000",
  fillOpacity: 0.25,
  lineWidth: 3,
  casingWidth: 7,
  nodeRadius: 5,
  haloRadius: 9,
  changesetColor: "#FF9500"
};

OSM.MapLibre.buildDataLayerStyle = function (theme = "light") {
  const s = OSM.MapLibre.DATA_LAYER_STYLE;
  const casingColor = theme === "dark" ? s.casingColorDark : s.casingColorLight;

  const hoverCase = (base, hover) => [
    "case", ["boolean", ["feature-state", "hover"], false], hover, base
  ];

  return {
    "area-fill": {
      type: "fill",
      filter: ["==", ["get", "featureKind"], "area"],
      paint: {
        "fill-color": hoverCase(s.color, s.hoverColor),
        "fill-opacity": s.fillOpacity
      }
    },
    "line-casing": {
      type: "line",
      filter: ["match", ["get", "featureKind"], ["line", "area"], true, false],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": casingColor,
        "line-width": s.casingWidth
      }
    },
    "line": {
      type: "line",
      filter: ["match", ["get", "featureKind"], ["line", "area"], true, false],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": hoverCase(s.color, s.hoverColor),
        "line-width": s.lineWidth
      }
    },
    "node-halo": {
      type: "circle",
      filter: ["==", ["get", "featureKind"], "point"],
      paint: {
        "circle-radius": s.haloRadius,
        "circle-color": casingColor,
        "circle-stroke-width": 0
      }
    },
    "node": {
      type: "circle",
      filter: ["==", ["get", "featureKind"], "point"],
      paint: {
        "circle-radius": s.nodeRadius,
        "circle-color": hoverCase(s.color, s.hoverColor),
        "circle-stroke-width": 0
      }
    },
    "changeset-fill": {
      type: "fill",
      filter: ["==", ["get", "featureKind"], "changeset"],
      paint: {
        "fill-color": s.changesetColor,
        "fill-opacity": 0
      }
    },
    "changeset-line": {
      type: "line",
      filter: ["==", ["get", "featureKind"], "changeset"],
      paint: {
        "line-color": s.changesetColor,
        "line-width": s.lineWidth
      }
    }
  };
};

