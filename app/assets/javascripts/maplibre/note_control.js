//= require maplibre/zoom_button

OSM.MapLibre.note = function () {
  return OSM.MapLibre.zoomButton({
    uiClass: "note",
    icon: "chat-square-text-fill",
    titleKey: "javascripts.site.createnote_tooltip",
    disabledTitleKey: "javascripts.site.createnote_disabled_tooltip",
    minZoom: 12,
    extraDisabled: () => OSM.STATUS === "database_offline"
  });
};
