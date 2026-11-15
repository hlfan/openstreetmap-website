# frozen_string_literal: true

require "application_system_test_case"

class DirectionsSystemTest < ApplicationSystemTestCase
  test "OSRM U-turn icons follow the driving side" do
    visit directions_path(:anchor => "map=15/1/1")
    assert_selector "#directions_route", :visible => :all
    stub_disable_reverse_geocoding
    page.execute_script(<<~JS)
      const originalFetch = window.fetch;
      window.fetch = function (input, options) {
        const url = typeof input === "string" ? input : input.url;
        if (!url.startsWith(OSM.FOSSGIS_OSRM_URL)) return originalFetch.call(this, input, options);
        const step = (driving_side, name) => ({
          driving_side, name, mode: "driving", intersections: [],
          maneuver: { type: "turn", modifier: "uturn" },
          distance: 10, geometry: "_ibE_ibEo}@o}@"
        });
        const response = {
          code: "Ok",
          waypoints: [{ hint: "start" }, { hint: "end" }],
          routes: [{ legs: [{
            distance: 20, duration: 10,
            steps: [step("right", "Right Road"), step("left", "Left Road")]
          }] }]
        };
        return Promise.resolve(new Response(JSON.stringify(response), { status: 200 }));
      };
    JS
    select "OSRM", :from => "routing_engines"
    find_by_id("route_from").set("1, 1").send_keys :enter
    find_by_id("route_to").set("1.01, 1.01").send_keys :enter

    within "#directions_route_steps" do
      assert_selector "tr:nth-child(1) use[href='#routing-sprite-u-turn-left']", :visible => :all
      assert_selector "tr:nth-child(2) use[href='#routing-sprite-u-turn-right']", :visible => :all
      assert_text "U-turn along Right Road"
      assert_text "U-turn along Left Road"
    end
    assert_selector "symbol#routing-sprite-u-turn-left", :visible => :all
    assert_selector "symbol#routing-sprite-u-turn-right", :visible => :all
    assert page.evaluate_script("Boolean(window.__map__.getSource('directions-route'))")
  end

  test "routing icons overlay inputs and can be dragged onto the map" do
    visit directions_path(:anchor => "map=15/1/1")
    assert_selector "#directions_route", :visible => :all
    within "#sidebar" do
      assert_selector ".routing_marker_column [data-type='from'] svg title", :text => "Route start marker", :visible => :all
      assert_selector ".routing_marker_column [data-type='to'] svg title", :text => "Route end marker", :visible => :all
    end
    assert_selector "svg.d-none[aria-hidden='true']", :visible => :all
    stub_disable_reverse_geocoding
    icon = find("#sidebar .routing_marker_column span[data-type='from']")
    assert page.evaluate_script(<<~JS, icon)
      (icon => {
        const input = icon.closest(".d-grid").querySelector("input");
        const a = icon.getBoundingClientRect();
        const b = input.getBoundingClientRect();
        const target = document.elementFromPoint(a.left + a.width / 2, a.top + a.height / 2);
        return a.left >= b.left && a.right <= b.right && a.top < b.bottom && a.bottom > b.top &&
          (target === icon || icon.contains(target));
      })(arguments[0])
    JS
    icon.drag_to(find_by_id("map"))
    assert_selector "#sidebar input[name='route_from'][data-lat][data-lon]"
    assert_match(/,/, find("#sidebar input[name='route_from']").value)
    assert_selector "#map .maplibre-gl-marker use[href='#pin-start']", :visible => :all
  end

  test "mobile directions stay open until a route is requested" do
    original_size = page.current_window.size
    page.current_window.resize_to(600, 800)
    visit root_path(:anchor => "map=15/1/1")
    find(".navbar-toggler").click
    within("#header-nav") { find(".switch_link").click }
    assert_current_path directions_path
    assert_selector ".navbar-toggler[aria-expanded='true']:not(.collapsed)"
    assert_selector "#directions_route", :visible => :all
    stub_straight_routing
    stub_disable_reverse_geocoding
    within("#header-nav") do
      find_field(:name => "route_from").set("1, 1").send_keys :enter
      find_field(:name => "route_to").set("1.01, 1.01").send_keys :enter
    end
    assert_selector ".navbar-toggler.collapsed[aria-expanded='false']"
    assert_no_selector "#header-nav", :visible => :visible
    within_sidebar { assert_content "Start here" }
  ensure
    page.current_window.resize_to(*original_size) if original_size
  end

  test "updates route output on mode change" do
    visit directions_path

    find_by_id("route_from").set("60 30").send_keys :enter
    stub_straight_routing(:start_instruction => "Start popup text")
    find_by_id("route_to").set("61 31").send_keys :enter

    within "#sidebar" do
      assert_content "Start popup text (car)"
    end

    choose :option => "bicycle", :allow_label_click => true

    within "#sidebar" do
      assert_content "Start popup text (bicycle)"
    end
  end

  test "swaps route endpoints on reverse button click" do
    visit directions_path

    find_by_id("route_from").set("60 30").send_keys :enter
    stub_straight_routing(:start_instruction => "Start popup text")
    stub_disable_reverse_geocoding
    find_by_id("route_to").set("61 31").send_keys :enter

    click_on :class => "reverse_directions"

    start_location = find_by_id("route_from").value
    finish_location = find_by_id("route_to").value

    click_on :class => "reverse_directions"

    assert_equal finish_location, find_by_id("route_from").value
    assert_equal start_location, find_by_id("route_to").value
  end

  test "removes popup on sidebar close" do
    visit directions_path

    find_by_id("route_from").set("60 30").send_keys :enter
    stub_straight_routing(:start_instruction => "Start popup text")
    find_by_id("route_to").set("61 31").send_keys :enter

    within "#map" do
      assert_no_content "Start popup text"
    end

    within_sidebar do
      direction_entry = find "td", :text => "Start popup text"
      direction_entry.click
    end

    within "#map" do
      assert_content "Start popup text"
    end

    find("#sidebar .sidebar-close-controls button[aria-label='Close']").click

    within "#map" do
      assert_no_content "Start popup text"
    end
  end

  test "shows a routing error while directions are active" do
    visit directions_path
    assert_selector "#directions_route", :visible => :all
    stub_disable_reverse_geocoding
    stub_routing 'return Promise.reject(new Error("Routing unavailable"));'

    find_by_id("route_from").set("1, 1").send_keys :enter
    find_by_id("route_to").set("1.01, 1.01").send_keys :enter

    assert_selector "#directions_error .alert.alert-danger"
  end

  private

  def stub_straight_routing(start_instruction: "Start here", finish_instruction: "Finish there")
    stub_routing <<~CALLBACK
      const distance = maplibregl.LngLat.convert(points[0]).distanceTo(maplibregl.LngLat.convert(points[1]));
      const time = distance * 30;
      return Promise.resolve({
        line: points,
        steps: [
          ["start", `<b>1.</b> #{start_instruction} (${this.mode})`, distance, points],
          ["destination", `<b>2.</b> #{finish_instruction} (${this.mode})`, 0, [points[1]]]
        ],
        distance,
        time
      });
    CALLBACK
  end

  def stub_routing(callback_code)
    execute_script <<~SCRIPT
      $(() => {
        for (const engine of OSM.directionsEngines) {
          engine.getRoute = function(points, signal) {
              #{callback_code}
          };
        }
      });
    SCRIPT
  end

  def stub_disable_reverse_geocoding
    execute_script <<~SCRIPT
      $(() => {
        const originalFetch = window.fetch;
        window.fetch = function(input, init) {
          if (!input?.url?.startsWith(OSM.NOMINATIM_URL)) return originalFetch.apply(this, arguments);
          return Promise.resolve(new Response(JSON.stringify({}), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }));
        };
      });
    SCRIPT
  end
end
