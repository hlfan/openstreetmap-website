# frozen_string_literal: true

require "application_system_test_case"

class QueryFeaturesSystemTest < ApplicationSystemTestCase
  test "replacing a query removes visible result geometry" do
    visit "/#map=15/1/1"
    assert_selector "#map .maplibregl-canvas"
    assert page.evaluate_async_script("const done = arguments[0]; window.__map__.onceStyleReady(() => done(true));")
    stub_overpass :nearby_elements => [
      { "type" => "node", "id" => 12, "lat" => 1, "lon" => 1, "tags" => { "name" => "First geometry" } },
      { "type" => "node", "id" => 13, "lat" => 1.001, "lon" => 1.001, "tags" => { "name" => "Second geometry" } }
    ]
    page.execute_script("OSM.router.route('/query?lat=1&lon=1#map=15/1/1')")
    assert_selector "#query-nearby a", :text => "First geometry"
    assert_selector "#query-nearby a", :text => "Second geometry"

    ids = page.evaluate_script(<<~JS)
      (() => {
        const links = $("#query-nearby a");
        links.attr("data-previous-query", "yes").trigger("mouseover");
        return links.map((_, link) => $(link).data("geometryId")).get();
      })()
    JS
    assert_equal 2, ids.length
    assert_equal 2, ids.uniq.length
    assert(ids.all? { |id| id&.start_with?("query-geom-") })
    assert page.evaluate_script("arguments[0].every(id => window.__map__.getSource(id) && window.__map__.getLayer(id))", ids)

    page.execute_script("OSM.router.route('/query?lat=1.1&lon=1.2#map=15/1/1')")
    assert_current_path "/query?lat=1.1&lon=1.2"
    assert_no_selector "#query-nearby a[data-previous-query='yes']"
    assert_selector "#query-nearby a", :text => "First geometry"
    assert page.evaluate_script("arguments[0].every(id => !window.__map__.getSource(id) && !window.__map__.getLayer(id))", ids)
    marker = page.evaluate_script(<<~JS)
      (() => {
        const map = window.__map__, source = map.getSource("query-marker");
        if (!source) return null;
        const coordinates = source.serialize().data.geometry.coordinates[0];
        const center = [0, 1].map(axis => {
          const values = coordinates.map(point => point[axis]);
          return (Math.min(...values) + Math.max(...values)) / 2;
        });
        return { center, fill: !!map.getLayer("query-marker-fill"), line: !!map.getLayer("query-marker-line") };
      })()
    JS
    assert marker
    assert marker["fill"]
    assert marker["line"]
    assert_in_delta 1.2, marker["center"][0], 0.00001
    assert_in_delta 1.1, marker["center"][1], 0.00001

    next_id = page.evaluate_script(<<~JS)
      (() => {
        const link = $("#query-nearby a").first();
        link.trigger("mouseover");
        return link.data("geometryId");
      })()
    JS
    assert_not_includes ids, next_id
    assert page.evaluate_script("!!window.__map__.getSource(arguments[0])", next_id)
    page.execute_script('$("#query-nearby a").first().trigger("mouseout").trigger("mouseout")')
    assert_not page.evaluate_script("!!window.__map__.getSource(arguments[0])", next_id)
    page.execute_script("OSM.router.route('/export#map=15/1/1')")
    assert_selector "#sidebar_content h2", :text => "Export"
    assert_not page.evaluate_script("!!window.__map__.getSource(arguments[0])", next_id)
  end

  test "deferred query result geometry cannot reappear after leaving a second query" do
    visit "/#map=15/1/1"
    assert_selector "#map .maplibregl-canvas"
    assert page.evaluate_async_script("const done = arguments[0]; window.__map__.onceStyleReady(() => done(true));")
    stub_overpass :nearby_elements => [
      { "type" => "node", "id" => 12, "lat" => 1, "lon" => 1, "tags" => { "name" => "Test geometry" } }
    ]
    page.execute_script("OSM.router.route('/query?lat=1&lon=1#map=15/1/1')")
    assert_selector "#query-nearby a", :text => "Test geometry"
    page.execute_script(<<~JS)
      const map = window.__map__;
      window.savedStyleReady = map.onceStyleReady;
      window.deferredStyleCallbacks = [];
      map.onceStyleReady = callback => window.deferredStyleCallbacks.push(callback);
      const link = $("#query-nearby a");
      link.attr("data-previous-query", "yes");
      const before = window.deferredStyleCallbacks.length;
      link.trigger("mouseover");
      window.geometryId = link.data("geometryId");
      window.geometryCallback = window.deferredStyleCallbacks[before];
      window.geometryCallbacksAdded = window.deferredStyleCallbacks.length - before;
      OSM.router.route("/query?lat=1.1&lon=1.1#map=15/1/1");
    JS
    geometry_id = page.evaluate_script("window.geometryId")
    assert_match(/\Aquery-geom-\d+\z/, geometry_id)
    assert_equal 1, page.evaluate_script("window.geometryCallbacksAdded")
    assert page.evaluate_script("typeof window.geometryCallback === 'function'")
    assert_current_path "/query?lat=1.1&lon=1.1"
    assert_no_selector "#query-nearby a[data-previous-query='yes']"
    assert_selector "#query-nearby a", :text => "Test geometry"
    result = page.evaluate_script(<<~JS, geometry_id)
      ((id) => {
        window.geometryCallback();
        return [!!window.__map__.getSource(id), !!window.__map__.getLayer(id)];
      })(arguments[0])
    JS
    assert_equal [false, false], result
    page.execute_script("OSM.router.route('/export#map=15/1/1')")
    assert_selector "#export_commit", :visible => :all
    result = page.evaluate_script(<<~JS, geometry_id)
      ((id) => {
        const map = window.__map__;
        map.onceStyleReady = window.savedStyleReady;
        const errors = [];
        for (const callback of window.deferredStyleCallbacks) {
          try { callback(); } catch (error) { errors.push(error.message); }
        }
        return { errors, source: !!map.getSource(id), layer: !!map.getLayer(id) };
      })(arguments[0])
    JS
    assert_empty result["errors"]
    assert_not result["source"]
    assert_not result["layer"]
  end

  test "deferred query marker cannot reappear after navigation" do
    visit "/#map=15/1/1"
    assert_selector "#map .maplibregl-canvas"
    stub_overpass
    page.execute_script(<<~JS)
      const map = window.__map__;
      window.savedStyleReady = map.onceStyleReady;
      window.deferredStyleCallbacks = [];
      map.onceStyleReady = callback => {
        window.deferredStyleCallbacks.push(callback);
        document.body.dataset.queryHeld = "yes";
      };
      OSM.router.route("/query?lat=1&lon=1#map=15/1/1");
    JS
    assert_selector "body[data-query-held='yes']"
    page.execute_script("OSM.router.route('/export#map=15/1/1')")
    assert_selector "#export_commit", :visible => :all
    result = page.evaluate_script(<<~JS)
      (() => {
        const map = window.__map__;
        map.onceStyleReady = window.savedStyleReady;
        const errors = [];
        for (const callback of window.deferredStyleCallbacks) {
          try { callback(); } catch (error) { errors.push(error.message); }
        }
        return { count: window.deferredStyleCallbacks.length, errors, marker: !!map.getSource("query-marker") };
      })()
    JS
    assert_operator result["count"], :>, 0
    assert_empty result["errors"]
    assert_not result["marker"]
  end

  test "sorts enclosing features correctly" do
    visit "/#map=15/54.18315/7.88473"

    within "#map" do
      click_on "Query features"

      stub_overpass :enclosing_elements => [
        {
          "type" => "relation",
          "id" => 51477,
          "bounds" => {
            "minlat" => 47.2701114,
            "minlon" => 5.8663153,
            "maxlat" => 55.0991610,
            "maxlon" => 15.0419309
          },
          "tags" => {
            "admin_level" => "2",
            "border_type" => "country",
            "boundary" => "administrative",
            "name" => "Deutschland",
            "name:de" => "Deutschland",
            "name:en" => "Germany",
            "type" => "boundary"
          }
        },
        {
          "type" => "relation",
          "id" => 51529,
          "bounds" => {
            "minlat" => 53.3598160,
            "minlon" => 7.5211615,
            "maxlat" => 55.0991610,
            "maxlon" => 11.6723860
          },
          "tags" => {
            "admin_level" => "4",
            "border_type" => "state",
            "boundary" => "administrative",
            "name" => "Schleswig-Holstein",
            "name:de" => "Schleswig-Holstein",
            "name:en" => "Schleswig-Holstein",
            "type" => "boundary"
          }
        },
        {
          "type" => "relation",
          "id" => 3787052,
          "bounds" => {
            "minlat" => 54.1693099,
            "minlon" => 7.8648436,
            "maxlat" => 54.1907839,
            "maxlon" => 7.9001626
          },
          "tags" => {
            "name" => "Helgoland",
            "name:de" => "Helgoland",
            "name:en" => "Heligoland",
            "place" => "island"
          }
        }
      ]

      click
    end

    within_sidebar do
      assert_link "Heligoland"
      assert_link "Schleswig-Holstein", :below => find_link("Heligoland")
      assert_link "Germany", :below => find_link("Schleswig-Holstein")
    end
  end

  test "sorts enclosing features correctly across antimeridian" do
    visit "/#map=15/60/30"

    within "#map" do
      click_on "Query features"

      stub_overpass :enclosing_elements => [
        {
          "type" => "relation",
          "id" => 60189,
          "bounds" => {
            "minlat" => 41.1850968,
            "minlon" => 19.4041722,
            "maxlat" => 82.0586232,
            "maxlon" => -168.9769440
          },
          "tags" => {
            "admin_level" => "2",
            "border_type" => "nation",
            "boundary" => "administrative",
            "name" => "Россия",
            "name:en" => "Russia",
            "name:ru" => "Россия",
            "type" => "boundary"
          }
        },
        {
          "type" => "relation",
          "id" => 1114253,
          "bounds" => {
            "minlat" => 59.8587853,
            "minlon" => 29.6720697,
            "maxlat" => 60.0370554,
            "maxlon" => 30.2307057
          },
          "tags" => {
            "name" => "Невская губа",
            "name:en" => "Neva Bay",
            "name:ru" => "Невская губа",
            "natural" => "bay",
            "type" => "multipolygon"
          }
        }
      ]

      click
    end

    within_sidebar do
      assert_link "Neva Bay"
      assert_link "Russia", :below => find_link("Neva Bay")
    end
  end

  test "sorts enclosing features correctly with multiple bboxes across antimeridian" do
    visit "/#map=15/-16.155/179.995"

    within "#map" do
      click_on "Query features"

      stub_overpass :enclosing_elements => [
        {
          "type" => "relation",
          "id" => 571747,
          "bounds" => {
            "minlat" => -21.9434274,
            "minlon" => 174.4214965,
            "maxlat" => -12.2613866,
            "maxlon" => -178.0034928
          },
          "tags" => {
            "admin_level" => "2",
            "boundary" => "administrative",
            "name" => "Viti",
            "name:en" => "Fiji",
            "name:fj" => "Viti",
            "type" => "boundary"
          }
        },
        {
          "type" => "relation",
          "id" => 2325025,
          "bounds" => {
            "minlat" => -17.0160140,
            "minlon" => 178.4754914,
            "maxlat" => -16.1243512,
            "maxlon" => -179.6630100
          },
          "tags" => {
            "name" => "Vanua Levu Group",
            "place" => "archipelago",
            "type" => "multipolygon",
            "wikidata" => "Q2756586"
          }
        },
        {
          "type" => "relation",
          "id" => 4097003,
          "bounds" => {
            "minlat" => -17.0160140,
            "minlon" => 178.4754914,
            "maxlat" => -16.1243512,
            "maxlon" => -179.9513876
          },
          "tags" => {
            "name" => "Vanua Levu",
            "place" => "island",
            "type" => "multipolygon",
            "wikidata" => "Q327733"
          }
        }
      ]

      click
    end

    within_sidebar do
      assert_link "Vanua Levu"
      assert_link "Vanua Levu Group", :below => find_link("Vanua Levu")
      assert_link "Fiji", :below => find_link("Vanua Levu Group")
    end
  end

  private

  def stub_overpass(nearby_elements: [], enclosing_elements: [])
    execute_script <<~SCRIPT
      {
        const originalFetch = fetch;
        window.fetch = (...args) => {
          const [resource, options] = args;

          if (resource != OSM.OVERPASS_URL) return originalFetch(...args);

          const data = options.body.get("data"),
                elements = data.includes("is_in") ? #{enclosing_elements.to_json} : #{nearby_elements.to_json};

          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ elements })
          });
        }
      }
    SCRIPT
  end
end
