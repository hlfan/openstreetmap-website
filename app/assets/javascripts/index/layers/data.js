//= require download_util

OSM.initializeDataLayer = function (map) {
  let dataLoader, loadedBounds;
  const dataLayer = map.dataLayer;

  dataLayer.on("click", function (e) {
    const feature = e.layer.feature;
    OSM.router.click(e.originalEvent, `/${feature.type}/${feature.id}`);
  });

  dataLayer.on("add", function () {
    map.fire("overlayadd", { layer: this });
    map.on("moveend", updateData);
    updateData();
  });

  dataLayer.on("remove", function () {
    if (dataLoader) dataLoader.abort();
    dataLoader = null;
    map.off("moveend", updateData);
    $("#browse_status").empty();
    map.fire("overlayremove", { layer: this });
  });

  function updateData() {
    const bounds = map.getBounds();
    // Skip fetches with out-of-range bounds (e.g. an unpositioned map at zoom
    // 0 whose wrapped viewport spans most of the world). The API will reject
    // them with a 400 and the Map Data overlay stays empty.
    if (OSM.MapLibre.boundsSize(bounds) >= OSM.MAX_REQUEST_AREA) return;
    if (!loadedBounds || !OSM.MapLibre.boundsContainBounds(loadedBounds, bounds)) {
      getData();
    }
  }

  function displayFeatureWarning(num_features, add, cancel) {
    $("#browse_status").html(
      $("<div class='p-3'>").append(
        $("<div class='d-flex'>").append(
          $("<h2 class='flex-grow-1 text-break'>")
            .text(OSM.i18n.t("browse.start_rjs.load_data")),
          $("<div>").append(
            $("<button type='button' class='btn-close'>")
              .attr("aria-label", OSM.i18n.t("javascripts.close"))
              .click(cancel))),
        $("<p class='alert alert-warning'>")
          .text(OSM.i18n.t("browse.start_rjs.feature_warning", { num_features })),
        $("<input type='submit' class='btn btn-primary d-block mx-auto'>")
          .val(OSM.i18n.t("browse.start_rjs.load_data"))
          .click(add)));
  }

  function getData() {
    /*
     * Modern browsers are quite happy showing far more than 100 features in
     * the data browser, so increase the limit to 4000.
     */
    const maxFeatures = 4000;
    const bounds = map.getBounds();

    if (dataLoader) dataLoader.abort();

    $("#layers-data-loading").remove();

    const spanLoading = $("<span>")
      .attr("id", "layers-data-loading")
      .attr("class", "spinner-border spinner-border-sm ms-1")
      .attr("role", "status")
      .html("<span class='visually-hidden'>" + OSM.i18n.t("browse.start_rjs.loading") + "</span>")
      .appendTo($("#label-layers-data"));

    dataLoader = new AbortController();

    function getWrappedBounds(bounds) {
      const sw = bounds.getSouthWest().wrap();
      const ne = bounds.getNorthEast().wrap();
      return {
        minLat: sw.lat,
        minLng: sw.lng,
        maxLat: ne.lat,
        maxLng: ne.lng
      };
    }

    function getRequestBounds(bounds) {
      const wrapped = getWrappedBounds(bounds);
      if (wrapped.minLng > wrapped.maxLng) {
        return [
          new maplibregl.LngLatBounds([wrapped.minLng, wrapped.minLat], [180, wrapped.maxLat]),
          new maplibregl.LngLatBounds([-180, wrapped.minLat], [wrapped.maxLng, wrapped.maxLat])
        ];
      }
      return [new maplibregl.LngLatBounds([wrapped.minLng, wrapped.minLat], [wrapped.maxLng, wrapped.maxLat])];
    }

    function fetchDataForBounds(bounds) {
      return fetch(`/api/${OSM.API_VERSION}/map.json?bbox=${OSM.MapLibre.boundsToBBoxString(bounds)}`, {
        headers: { ...OSM.oauth },
        signal: dataLoader.signal
      });
    }

    const requestBounds = getRequestBounds(bounds);
    const requests = requestBounds.map(fetchDataForBounds);

    Promise.all(requests)
      .then(responses =>
        Promise.all(
          responses.map(async response => {
            if (response.ok) {
              return response.json();
            }

            const status = response.statusText || response.status;
            if (response.status !== 400 && response.status !== 509) {
              throw new Error(status);
            }

            const text = await response.text();
            throw new Error(text || status);
          })
        )
      )
      .then(dataArray => {
        // The two-request split is purely an OSM API constraint (bbox
        // must be in [-180, 180] with minLng <= maxLng). Feature wrap
        // across ±180 is handled by MapLibre's renderWorldCopies: true
        // default, so both responses can be merged in canonical
        // coordinates without any per-half longitude shift.
        //
        // Main overlay never renders area polygons — ways are drawn as
        // lines. The element-highlight path (main_map#addObject) uses the
        // default isWayArea to render polygon fills for area members.
        const features = dataArray.flatMap(data =>
          OSM.MapLibre.osmJsonToGeoJSON(data, { isWayArea: () => false }).features
        );
        const featureCollection = { type: "FeatureCollection", features };

        function addFeatures() {
          $("#browse_status").empty();
          dataLayer.setData(featureCollection);
          loadedBounds = bounds;
          // The main-overlay render stacks above the element highlight;
          // restore the highlight on top so a selected element remains
          // visually distinct after each fetch.
          map.bringElementHighlightToFront();
        }

        function cancelAddFeatures() {
          $("#browse_status").empty();
        }

        if (features.length < maxFeatures * requestBounds.length) {
          addFeatures();
        } else {
          displayFeatureWarning(features.length, addFeatures, cancelAddFeatures);
        }
      })
      .catch(function (error) {
        if (error.name === "AbortError") return;

        OSM.displayLoadError(error?.message, () => {
          $("#browse_status").empty();
        });
      })
      .finally(() => {
        dataLoader = null;
        spanLoading.remove();
      });
  }
};
