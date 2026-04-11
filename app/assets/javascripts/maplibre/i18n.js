OSM.MapLibre.localizeMap = function (map, layer) {
  if (!layer || !layer.isVectorStyle) return;
  const locales = (Array.isArray(window.OSM?.preferred_languages) && OSM.preferred_languages.length) ?
    OSM.preferred_languages :
    maplibregl.Diplomat.getLocales();
  const options = layer.layerId === "shortbread" ?
    { localizedNamePropertyFormat: "name_$1" } :
    {};
  map.once("styledata", () => map.localizeStyle(locales, options));
};
