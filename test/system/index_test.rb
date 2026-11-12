# frozen_string_literal: true

require "application_system_test_case"

class IndexTest < ApplicationSystemTestCase
  test "keyboard starts manual export selection" do
    visit export_path(:anchor => "map=15/1/1")

    find_button("Manually select a different area").send_keys(:space)

    assert_no_button "Manually select a different area"
    assert_selector "#map .location-filter.resize-marker", :count => 4
  end

  test "export source follows map bounds without replacing the configured URL" do
    visit export_path(:anchor => "map=10/10/20")
    assert_selector "#export_overpass", :visible => :all
    page.execute_script("document.querySelector('#export_overpass').href = 'https://downloads.example.test/custom/map?old=value#section'")

    previous_bbox = nil
    [[-73, 40], [12, -25]].each do |center|
      result = page.evaluate_script(<<~JS, center)
        ((center) => {
          window.__map__.jumpTo({ center, zoom: 9 });
          const map = window.__map__;
          const bounds = map.getBounds();
          const sw = OSM.cropLocation(bounds.getSouthWest(), map.getZoom());
          const ne = OSM.cropLocation(bounds.getNorthEast(), map.getZoom());
          return {
            href: document.querySelector("#export_overpass").href,
            bbox: [sw.lng, sw.lat, ne.lng, ne.lat].join(","),
            fields: ["minlon", "minlat", "maxlon", "maxlat"].map(id => document.getElementById(id).value).join(",")
          };
        })(arguments[0])
      JS
      url = URI.parse(result["href"])
      assert_equal "https://downloads.example.test/custom/map", "#{url.scheme}://#{url.host}#{url.path}"
      assert_equal "section", url.fragment
      assert_equal "bbox=#{result['bbox']}", url.query
      assert_equal result["bbox"], result["fields"]
      assert_not_equal previous_bbox, result["bbox"] if previous_bbox
      previous_bbox = result["bbox"]
    end
  end

  test "desktop edit dropdown overlays the map" do
    original_size = page.current_window.size
    page.current_window.resize_to(800, 800)
    visit root_path(:anchor => "map=15/1/1")
    assert_selector "#map .maplibregl-canvas"
    within("#edit_tab") { click_button }
    assert_selector "#edit_tab .dropdown-menu.show"
    assert page.evaluate_script(<<~JS)
      (() => {
        const dropdown = document.querySelector("#edit_tab .dropdown-menu");
        const rect = dropdown.getBoundingClientRect();
        const map = document.querySelector("#map").getBoundingClientRect();
        const y = Math.max(rect.top, map.top) + 2;
        return y < rect.bottom &&
          dropdown.contains(document.elementFromPoint(rect.left + rect.width / 2, y));
      })()
    JS
  ensure
    page.current_window.resize_to(*original_size) if original_size
  end

  test "map popups and controls remain clickable above markers" do
    visit root_path(:anchor => "map=15/1/1")
    assert_selector "#map .maplibregl-canvas"
    assert_button "Zoom In"

    result = page.evaluate_script(<<~JS)
      (() => {
        const map = window.__map__;
        const popup = new OSM.MapLibre.Popup({ anchor: "center", offset: 0, closeButton: false })
          .setLngLat(map.getCenter())
          .setHTML('<button id="stacking-popup-target" type="button">Popup target</button>')
          .addTo(map);
        const targets = [popup.getElement().querySelector("button"), document.querySelector(".maplibregl-ctrl-zoom-in")];
        const mapRect = map.getContainer().getBoundingClientRect();

        return targets.map(target => {
          const rect = target.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          const element = document.createElement("div");
          Object.assign(element.style, { width: "100px", height: "100px", background: "red", zIndex: "2147483647" });
          const marker = new OSM.MapLibre.Marker({ element, anchor: "center" })
            .setLngLat(map.unproject([x - mapRect.left, y - mapRect.top]))
            .addTo(map);
          const markerRect = marker.getElement().getBoundingClientRect();
          return x > markerRect.left && x < markerRect.right && y > markerRect.top && y < markerRect.bottom &&
            target.contains(document.elementFromPoint(x, y));
        });
      })()
    JS
    assert_equal [true, true], result
    find_by_id("stacking-popup-target").click
    find_button("Zoom In").click
  end

  test "mobile navigation toggles and closes after map navigation and search" do
    original_size = page.current_window.size
    stub_request(:get, %r{^https://nominatim\.openstreetmap\.org/search\?}).to_return(:status => 404)
    page.current_window.resize_to(600, 800)
    visit root_path(:anchor => "map=15/1/1")
    assert_selector "#map .maplibregl-canvas"
    assert_selector ".navbar-toggler.collapsed[aria-expanded='false']"
    assert_no_selector "#header-nav", :visible => :visible

    find(".navbar-toggler").click
    assert_selector ".navbar-toggler[aria-expanded='true']:not(.collapsed)"
    assert_selector "#header-nav.show"
    find(".navbar-toggler").click
    assert_selector ".navbar-toggler.collapsed[aria-expanded='false']"
    assert_no_selector "#header-nav", :visible => :visible

    find(".navbar-toggler").click
    assert_selector "#header-nav.show"
    within("#secondary-nav-menu") { click_on "Export" }
    assert_current_path export_path
    assert_selector ".navbar-toggler.collapsed[aria-expanded='false']"
    assert_no_selector "#header-nav", :visible => :visible

    find(".navbar-toggler").click
    assert_selector "#header-nav.show"
    within("#header-nav .search_form") do
      fill_in "query", :with => "London"
      click_button "Go"
    end
    assert_current_path search_path, :ignore_query => true
    assert_selector ".navbar-toggler.collapsed[aria-expanded='false']"
    assert_no_selector "#header-nav", :visible => :visible
  ensure
    page.current_window.resize_to(*original_size) if original_size
  end

  test "deferred note halo cannot reappear after navigation" do
    visit root_path(:anchor => "map=18/1/1")
    assert_selector "#map .maplibregl-canvas"
    page.execute_script(<<~JS)
      const map = window.__map__;
      window.savedStyleReady = map.onceStyleReady;
      window.deferredStyleCallbacks = [];
      map.onceStyleReady = callback => window.deferredStyleCallbacks.push(callback);
      OSM.router.route("/note/new#map=18/1/1");
    JS
    assert_selector "#sidebar_content textarea"
    assert_selector "#map .maplibregl-marker", :count => 1
    page.execute_script("OSM.router.route('/export#map=18/1/1')")
    assert_selector "#export_commit", :visible => :all
    result = page.evaluate_script(<<~JS)
      (() => {
        const map = window.__map__;
        map.onceStyleReady = window.savedStyleReady;
        const errors = [];
        for (const callback of window.deferredStyleCallbacks) {
          try { callback(); } catch (error) { errors.push(error.message); }
        }
        return { count: window.deferredStyleCallbacks.length, errors, halo: !!map.getSource("new-note-halo") };
      })()
    JS
    assert_operator result["count"], :>, 0
    assert_empty result["errors"]
    assert_not result["halo"]
    assert_no_selector "#map .maplibregl-marker"
  end

  test "new note marker is removed and restored across browser navigation" do
    visit root_path(:anchor => "map=18/1/1")
    assert_selector "#map .maplibregl-canvas"
    page.execute_script("window.__map__.getCanvas().dataset.navigationTest = 'original'")
    page.execute_script("OSM.router.route('/note/new#map=18/1/1')")
    assert_current_path new_note_path
    assert_selector "#sidebar_content textarea"
    assert_selector "#map .maplibregl-marker", :count => 1

    page.execute_script("OSM.router.route('/export#map=18/1/1')")
    assert_current_path export_path
    assert_selector "#sidebar_content #export_commit", :visible => :all
    assert_no_selector "#map .maplibregl-marker"
    assert_not page.evaluate_script("Boolean(window.__map__.getSource('new-note-halo'))")

    page.go_back
    assert_current_path new_note_path
    assert_selector "#sidebar_content textarea"
    assert_selector "#map .maplibregl-marker", :count => 1
    assert_selector "#map canvas[data-navigation-test='original']"
    assert_in_delta 18, page.evaluate_script("window.__map__.getZoom()"), 0.01
    assert_in_delta 1, page.evaluate_script("window.__map__.getCenter().lat"), 0.00001
    assert_in_delta 1, page.evaluate_script("window.__map__.getCenter().lng"), 0.00001
  end

  test "element changeset and directions transitions retain map state and remove objects" do
    node = create(:node, :lat => 1, :lon => 1)
    wait_for_changeset = lambda do
      page.evaluate_async_script(<<~JS)
        const done = arguments[0], started = performance.now();
        function check() {
          const type = window.__map__._object?.type;
          if (type === "changeset" || performance.now() - started > 1200) done(type || null);
          else requestAnimationFrame(check);
        }
        check();
      JS
    end
    visit root_path(:anchor => "map=18/1/1")
    assert_selector "#map .maplibregl-canvas"
    page.execute_script("window.__map__.getCanvas().dataset.navigationTest = 'original'")

    page.execute_script("OSM.router.route(arguments[0])", "#{node_path(node)}#map=18/1/1")
    assert_current_path node_path(node)
    assert_selector "#sidebar_content h2", :text => "Node: #{node.id}"
    object = page.evaluate_async_script(<<~JS)
      const done = arguments[0];
      const started = performance.now();
      function check() {
        const object = window.__map__._object;
        if (object?.type === "node" || performance.now() - started > 5000) done(object || null);
        else requestAnimationFrame(check);
      }
      check();
    JS
    assert_equal "node", object["type"]

    page.execute_script("OSM.router.route(arguments[0])", "#{changeset_path(node.changeset)}#map=18/1/1")
    assert_current_path changeset_path(node.changeset)
    assert_selector "#sidebar_content [data-changeset]"
    assert_equal "changeset", wait_for_changeset.call

    page.execute_script("OSM.router.route('/directions#map=18/1/1')")
    assert_current_path directions_path
    assert_selector ".directions_form", :visible => :visible
    assert_selector "#sidebar_content #directions_route", :visible => :all
    assert_nil page.evaluate_script("window.__map__._object")
    assert_selector "#map canvas[data-navigation-test='original']"
    assert_in_delta 18, page.evaluate_script("window.__map__.getZoom()"), 0.01
    # Directions overlays the sidebar and deliberately pans the viewport.
    assert_in_delta 1, page.evaluate_script("window.__map__.getCenter().lat"), 0.005
    assert_in_delta 1, page.evaluate_script("window.__map__.getCenter().lng"), 0.005

    page.go_back
    assert_current_path changeset_path(node.changeset)
    assert_selector "#sidebar_content [data-changeset]"
    assert_equal "changeset", wait_for_changeset.call
    assert_selector "#map canvas[data-navigation-test='original']"
  end

  test "synthetic element navigation preserves the map hash" do
    visit root_path(:anchor => "map=15/1/1")
    assert_selector "#map .maplibregl-canvas"

    result = page.evaluate_script(<<~JS)
      (() => {
        let hash;
        const capture = event => {
          hash = event.target.hash;
          event.preventDefault();
          event.stopImmediatePropagation();
        };
        document.addEventListener("click", capture, true);
        try {
          OSM.router.click(new MouseEvent("click", { bubbles: true }), "/node/123");
          return { expected: location.hash, actual: hash };
        } finally {
          document.removeEventListener("click", capture, true);
        }
      })()
    JS

    assert_match %r{\A#map=15/1(?:\.0+)?/1(?:\.0+)?\z}, result["expected"]
    assert_equal result["expected"], result["actual"]
  end

  test "zoom buttons change the map and hash by one OSM level" do
    visit root_path(:anchor => "map=12/10/20")
    assert_selector "#map .maplibregl-canvas"

    [["Zoom In", 13], ["Zoom Out", 12]].each do |button, expected_zoom|
      find_button(button).click
      zoom = page.evaluate_async_script(<<~JS, expected_zoom)
        const [expected, done] = arguments;
        const start = performance.now();
        function check() {
          const map = window.__map__;
          const hashZoom = OSM.parseHash(location.hash).zoom;
          if ((!map.isMoving() && hashZoom === expected) || performance.now() - start > 5000) {
            done({
              osm: map.getZoom(),
              native: maplibregl.Map.prototype.getZoom.call(map),
              hash: hashZoom
            });
          } else {
            requestAnimationFrame(check);
          }
        }
        check();
      JS

      assert_in_delta expected_zoom, zoom["osm"], 0.00001
      assert_in_delta expected_zoom - 1, zoom["native"], 0.00001
      assert_equal expected_zoom, zoom["hash"]
    end
  end

  test "map control labels and scale units are translated" do
    visit root_path(:anchor => "map=12/10/20")
    assert_selector "#map canvas[aria-label='Map']"
    assert_button "Zoom In"
    assert_button "Zoom Out"
    assert_selector "#map .maplibregl-ctrl-attrib-button[aria-label='Toggle Attribution']", :visible => :all
    page.execute_script(<<~JS)
      const map = window.__map__;
      new OSM.MapLibre.Marker().setLngLat([20, 10]).addTo(map);
      new OSM.MapLibre.Popup().setLngLat([20, 10]).setText("Translation test").addTo(map);
      map.addControl(new maplibregl.ScaleControl({ unit: "nautical" }), "bottom-left");
      map.jumpTo({ center: [0, 0], zoom: 4 });
    JS
    assert_selector "#map .maplibre-gl-marker[aria-label='Map marker']", :visible => :all
    assert_selector "#map .maplibregl-popup-close-button[aria-label='Close']", :visible => :all
    assert_equal "You are within 1 meter of this point",
                 page.evaluate_script("OSM.i18n.t('javascripts.map.GeolocateControl.metersPopup', { count: 1 })")
    assert_equal "You are within 2 feet of this point",
                 page.evaluate_script("OSM.i18n.t('javascripts.map.GeolocateControl.feetPopup', { count: 2 })")
    assert_selector "#map .maplibregl-ctrl-scale", :text => /\d+\s+km/
    assert_selector "#map .maplibregl-ctrl-scale", :text => /\d+\s+mi/
    assert_selector "#map .maplibregl-ctrl-scale", :text => /\d+\s+nm/

    page.execute_script("window.__map__.jumpTo({ zoom: 18 })")
    assert_selector "#map .maplibregl-ctrl-scale", :text => /\d+\s+m\z/
    assert_selector "#map .maplibregl-ctrl-scale", :text => /\d+\s+ft\z/
  end

  test "map control labels use the selected language" do
    visit root_path(:locale => "de", :anchor => "map=12/10/20")
    assert_selector "html[lang='de']"
    assert_selector "#map canvas[aria-label='Karte']"
    assert_button "Vergrößern"
    assert_button "Verkleinern"
    assert_selector "#map button[aria-label='Aktuellen Standort anzeigen']", :visible => :all
    assert_selector "#map .maplibregl-ctrl-attrib-button[aria-label='Quellenangabe umschalten']", :visible => :all
    page.execute_script(<<~JS)
      const map = window.__map__;
      new OSM.MapLibre.Marker().setLngLat([20, 10]).addTo(map);
      new OSM.MapLibre.Popup().setLngLat([20, 10]).setText("Translation test").addTo(map);
    JS
    assert_selector "#map .maplibre-gl-marker[aria-label='Kartenmarkierung']", :visible => :all
    assert_selector "#map .maplibregl-popup-close-button[aria-label='Schließen']", :visible => :all
    assert_equal "Du bist weniger als 2 Meter von diesem Punkt entfernt",
                 page.evaluate_script("OSM.i18n.t('javascripts.map.GeolocateControl.metersPopup', { count: 2 })")
  end

  test "map navigation restores hash and position on back and forward" do
    visit root_path(:anchor => "map=15/1/1")
    assert_selector "#map .maplibregl-canvas"
    assert_not page.evaluate_script("Turbo.session.history.started"), "Turbo must not own popstate on the map"
    page.execute_script(<<~JS)
      window.__map__.getCanvas().dataset.navigationTest = "original";
      const link = document.createElement("a");
      link.id = "navigation-test-link";
      link.href = "/export" + location.hash;
      link.textContent = "Navigate to export";
      link.style.cssText = "position:fixed;bottom:10px;left:100px;z-index:9999;background:white";
      document.body.appendChild(link);
    JS
    click_on "Navigate to export"
    assert_current_path export_path
    assert_selector "#sidebar_content #export_commit", :visible => :all
    assert_selector "#map canvas[data-navigation-test='original']"

    page.execute_script("window.__map__.jumpTo({ center: [2, 3], zoom: 14 })")
    assert_match %r{\A#map=15/3(?:\.0+)?/2(?:\.0+)?\z}, page.evaluate_script("location.hash")

    check_state = lambda do |path, lat, lon|
      assert_current_path path
      result = page.evaluate_async_script(<<~JS, lat, lon)
        const [lat, lon, done] = arguments;
        const start = performance.now();
        function check() {
          const center = window.__map__.getCenter();
          const state = OSM.parseHash(location.hash);
          if ((Math.abs(center.lat - lat) < 0.00001 && Math.abs(center.lng - lon) < 0.00001 &&
               Math.abs(state.center.lat - lat) < 0.00001 && Math.abs(state.center.lng - lon) < 0.00001) ||
              performance.now() - start > 5000) {
            done({ lat: center.lat, lon: center.lng, hash: location.hash });
          } else {
            requestAnimationFrame(check);
          }
        }
        check();
      JS
      assert_in_delta lat, result["lat"], 0.00001
      assert_in_delta lon, result["lon"], 0.00001
      assert_match %r{\A#map=15/#{lat}(?:\.0+)?/#{lon}(?:\.0+)?\z}, result["hash"]
      assert_selector "#map canvas[data-navigation-test='original']"
    end

    page.go_back
    check_state.call(root_path, 1, 1)
    page.go_forward
    check_state.call(export_path, 3, 2)
    assert_selector "#sidebar_content #export_commit", :visible => :all
  end

  test "map canvas resizes with both sidebars in desktop and mobile layouts" do
    original_size = page.current_window.size
    [1200, 600].each do |width|
      page.current_window.resize_to(width, 800)
      node = create(:node)
      visit node_path(node)
      assert_selector "#sidebar .btn-close"

      sizes = lambda do
        page.evaluate_script(<<~JS)
          (() => {
            const map = document.querySelector("#map");
            const canvas = window.__map__.getCanvas();
            return [map.clientWidth, map.clientHeight, canvas.clientWidth, canvas.clientHeight];
          })()
        JS
      end
      assert_canvas_size = lambda do
        dimensions = sizes.call
        assert_operator dimensions[0], :>, 0
        assert_operator dimensions[1], :>, 0
        assert_equal dimensions[0..1], dimensions[2..3]
        dimensions
      end

      initial = assert_canvas_size.call
      find("#sidebar .btn-close").click
      assert_selector "#content.overlay-sidebar"
      expanded = assert_canvas_size.call
      axis = width >= 768 ? 0 : 1
      assert_operator expanded[axis], :>, initial[axis]

      within("#map") { click_on "Share" }
      assert_selector "#map-ui", :visible => :visible
      with_pane = assert_canvas_size.call
      assert_operator with_pane[axis], :<, expanded[axis]

      within("#map-ui") { click_on "Close" }
      assert_no_selector "#map-ui", :visible => :visible
      assert_equal expanded, assert_canvas_size.call
    end
  ensure
    page.current_window.resize_to(*original_size) if original_size
  end

  test "initialized map and sidebars resize across responsive breakpoints" do
    original_size = page.current_window.size
    page.current_window.resize_to(1200, 800)
    node = create(:node)
    visit node_path(node)
    assert_selector "#sidebar .btn-close"
    page.execute_script("window.__map__.getCanvas().dataset.resizeTest = 'original'")
    find("#sidebar .btn-close").click
    assert_selector "#content.overlay-sidebar"

    within("#map") { click_on "Share" }
    assert_selector "#map-ui", :visible => :visible

    dimensions = lambda do
      page.evaluate_async_script(<<~JS)
        const done = arguments[0];
        const started = performance.now();
        function check() {
          const element = document.querySelector("#map");
          const map = window.__map__;
          const canvas = map.getCanvas();
          const width = element.clientWidth;
          const height = element.clientHeight;
          const ratio = window.devicePixelRatio;
          const result = [width, height, canvas.width, canvas.height, map.transform.width, map.transform.height, ratio];
          if ((width === map.transform.width && height === map.transform.height &&
               Math.abs(canvas.width - width * ratio) <= 1 && Math.abs(canvas.height - height * ratio) <= 1) ||
              performance.now() - started > 3000) {
            done(result);
          } else {
            requestAnimationFrame(check);
          }
        }
        check();
      JS
    end
    assert_resized = lambda do
      width, height, canvas_width, canvas_height, map_width, map_height, ratio = dimensions.call
      assert_operator width, :>, 0
      assert_operator height, :>, 0
      assert_equal [width, height], [map_width, map_height]
      assert_in_delta width * ratio, canvas_width, 1
      assert_in_delta height * ratio, canvas_height, 1
      [width, height]
    end

    desktop_with_pane = assert_resized.call
    page.current_window.resize_to(600, 800)
    mobile_with_pane = assert_resized.call
    assert_operator mobile_with_pane[0], :<, desktop_with_pane[0]
    assert_selector "#map-ui", :visible => :visible

    within("#map-ui") { click_on "Close" }
    assert_no_selector "#map-ui", :visible => :visible
    mobile_without_pane = assert_resized.call
    assert_operator mobile_without_pane[1], :>, mobile_with_pane[1]

    within("#map") { click_on "Share" }
    assert_selector "#map-ui", :visible => :visible
    assert_equal mobile_with_pane, assert_resized.call
    page.current_window.resize_to(1200, 800)
    assert_selector "#map-ui", :visible => :visible
    assert_equal desktop_with_pane, assert_resized.call
    within("#map-ui") { click_on "Close" }
    assert_no_selector "#map-ui", :visible => :visible
    assert_operator assert_resized.call[0], :>, desktop_with_pane[0]
    assert_selector "#map canvas[data-resize-test='original']"
    assert_current_path root_path
  ensure
    page.current_window.resize_to(*original_size) if original_size
  end

  test "should remove and add an overlay on share button click" do
    node = create(:node)

    visit node_path(node)

    assert_selector "#content.overlay-right-sidebar"

    within "#map" do
      click_on "Share"
    end

    assert_no_selector "#content.overlay-right-sidebar"

    within "#map" do
      click_on "Share"
    end

    assert_selector "#content.overlay-right-sidebar"
  end

  test "should add an overlay on close" do
    node = create(:node)

    visit node_path(node)

    within "#map" do
      click_on "Share"
    end

    assert_no_selector "#content.overlay-right-sidebar"

    within "#map-ui" do
      click_on "Close"
    end

    assert_selector "#content.overlay-right-sidebar"
  end

  test "should not add overlay when not closing right menu popup" do
    node = create(:node)

    visit node_path(node)

    within "#map" do
      click_on "Share"
      click_on "Legend"
    end

    assert_no_selector "#content.overlay-right-sidebar"

    within "#map" do
      click_on "Layers"
    end

    assert_no_selector "#content.overlay-right-sidebar"

    within "#map" do
      click_on "Legend"
    end

    assert_no_selector "#content.overlay-right-sidebar"

    within "#map" do
      click_on "Legend"
    end

    assert_selector "#content.overlay-right-sidebar"
  end

  test "node included in edit link" do
    node = create(:node)
    visit node_path(node)
    assert_selector "#editanchor[href*='?node=#{node.id}#']"

    find("#sidebar .btn-close").click
    assert_no_selector "#editanchor[href*='?node=#{node.id}#']"
  end

  test "note included in edit link" do
    note = create(:note_with_comments)
    visit note_path(note)
    assert_selector "#editanchor[href*='?note=#{note.id}#']"

    find("#sidebar .btn-close").click
    assert_no_selector "#editanchor[href*='?note=#{note.id}#']"
  end

  test "can navigate from hidden note to visible note" do
    sign_in_as(create(:moderator_user))
    hidden_note = create(:note, :status => "hidden", :description => "Hidden Note Description")
    create(:note_comment, :note => hidden_note, :body => "this-is-a-hidden-note", :event => "opened")
    position = (1.003 * GeoRecord::SCALE).to_i
    visible_note = create(:note, :latitude => position, :longitude => position, :description => "Visible Note Description")
    create(:note_comment, :note => visible_note, :body => "this-is-a-visible-note", :event => "opened")

    visit root_path(:anchor => "map=15/1/1") # view place of hidden note in case it is not rendered during note_path(hidden_note)
    visit note_path(hidden_note)

    within "#map" do
      click_on "Layers"
    end
    within "#map-ui" do
      check "Map Notes"
    end

    within_sidebar do
      assert_text "Hidden Note Description"
    end

    visible_note_marker = find(".maplibre-gl-marker[title=this-is-a-visible-note]")
    visible_note_marker.click

    within_sidebar do
      assert_text "Visible Note Description"
    end
  end
end
