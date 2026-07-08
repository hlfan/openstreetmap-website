export default function (map) {
  $("#sidebar_content")
    .on("click", ".search_more a", clickSearchMore)
    .on("click", ".search_results_entry a.set_position", clickSearchResult);

  const markers = [];
  let processedResults = 0;

  function clickSearchMore(e) {
    e.preventDefault();
    e.stopPropagation();

    const div = $(this).parents(".search_more");

    $(this).hide();
    div.find(".loader").prop("hidden", false);

    fetchReplace(this, div);
  }

  function fetchReplace({ href }, $target) {
    return fetch(href, {
      method: "POST",
      body: new URLSearchParams(OSM.csrf)
    })
      .then(response => response.text())
      .then(html => {
        const result = $(html);
        $target.replaceWith(result);
        result.filter("ul").children().each(showSearchResult);
      });
  }

  function showSearchResult() {
    const index = processedResults++;
    const listItem = $(this);
    const inverseGoldenAngle = (Math.sqrt(5) - 1) * 180;
    const color = `hwb(${(index * inverseGoldenAngle) % 360}deg 5% 5%)`;
    listItem.css("--marker-color", color);
    const data = listItem.find("a.set_position").data();
    const marker = new OSM.MapLibre.Marker({ icon: "dot", color, className: "activatable" })
      .setLngLat([data.lon, data.lat])
      .addTo(map);
    marker.getElement().addEventListener("mouseover", () => listItem.addClass("bg-body-secondary"));
    marker.getElement().addEventListener("mouseout", () => listItem.removeClass("bg-body-secondary"));
    marker.getElement().addEventListener("click", function (e) {
      OSM.router.click(e, listItem.find("a.set_position").attr("href"));
    });
    markers.push(marker);
    listItem.on("mouseover", () => $(marker.getElement()).addClass("active"));
    listItem.on("mouseout", () => $(marker.getElement()).removeClass("active"));
  }

  function panToSearchResult(data) {
    if (data.minLon && data.minLat && data.maxLon && data.maxLat) {
      map.fitBounds(new maplibregl.LngLatBounds(
        [data.minLon, data.minLat],
        [data.maxLon, data.maxLat]
      ));
    } else {
      map.setView({ lng: data.lon, lat: data.lat }, data.zoom);
    }
  }

  function clickSearchResult(e) {
    const data = $(this).data();

    panToSearchResult(data);

    // Let clicks to object browser links propagate.
    if (data.type && data.id) return;

    e.preventDefault();
    e.stopPropagation();
  }

  const page = {};

  page.pushstate = page.popstate = function (path) {
    const params = new URLSearchParams(path.substring(path.indexOf("?")));
    if (params.has("query")) {
      $(".search_form input[name=query]").val(params.get("query"));
    } else if (params.has("lat") && params.has("lon")) {
      $(".search_form input[name=query]").val(params.get("lat") + ", " + params.get("lon"));
    }
    OSM.loadSidebarContent(path, page.load);
  };

  page.load = function () {
    $(".search_results_entry[data-href]").each(function (index) {
      const entry = $(this);
      fetchReplace(this.dataset, entry.children().first())
        .then(() => {
          // go to first result of first geocoder
          if (index === 0) {
            const firstResult = entry.find("*[data-lat][data-lon]:first").first();
            if (firstResult.length) {
              panToSearchResult(firstResult.data());
            }
          }
        });
    });

    return map.getState();
  };

  page.unload = function () {
    for (const marker of markers) marker.remove();
    markers.length = 0;
    processedResults = 0;
  };

  return page;
}
