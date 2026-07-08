//= require maplibre/zoom_button

OSM.MapLibre.query = function () {
  return OSM.MapLibre.zoomButton({
    uiClass: "query",
    icon: "question-lg",
    titleKey: "javascripts.site.queryfeature_tooltip",
    disabledTitleKey: "javascripts.site.queryfeature_disabled_tooltip",
    minZoom: 14
  });
};
