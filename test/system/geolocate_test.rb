# frozen_string_literal: true

require "application_system_test_case"

class GeolocateTest < ApplicationSystemTestCase
  driven_by_selenium "default",
                     :driver_name => "default-reduced-motion",
                     :preferences => { "ui.prefersReducedMotion" => 1 }

  test "locate stops tracking after the map is dragged away" do
    visit root_path(:anchor => "map=10/1/2")
    install_location_control

    location_button.click
    send_location(1)
    assert_selector "#{location_button_selector}.maplibregl-ctrl-geolocate-active"
    assert_selector "#map .maplibregl-user-location-dot", :visible => :all
    assert_selector "#map .maplibregl-user-location-accuracy-circle", :visible => :all
    assert page.evaluate_script(<<~JS, location_button_selector)
      (selector => {
        const button = document.querySelector(selector);
        const dot = document.querySelector(".maplibregl-user-location-dot");
        const circle = document.querySelector(".maplibregl-user-location-accuracy-circle");
        return button.querySelector(".bi-cursor-fill") && button.getBoundingClientRect().width === 40 &&
          dot.getBoundingClientRect().width > 0 && circle.getBoundingClientRect().width > 0 &&
          getComputedStyle(dot).backgroundColor !== "rgba(0, 0, 0, 0)" &&
          Number(getComputedStyle(circle).opacity) > 0;
      })(arguments[0])
    JS
    page.execute_script(<<~JS)
      const map = window.__map__;
      map.stop();
      map.once("dragstart", () => {
        map.once("moveend", () => { window.__geolocation.dragFinished = true; });
      });
    JS

    canvas = find("#map .maplibregl-canvas")
    page.driver.browser.action.move_to(canvas.native).click_and_hold.move_by(45, 25).release.perform
    assert_selector "#{location_button_selector}.maplibregl-ctrl-geolocate-background"
    Selenium::WebDriver::Wait.new(:timeout => 10).until { page.evaluate_script("window.__geolocation.dragFinished === true") }
    center = map_center

    location_button.click
    assert_equal [1], page.evaluate_script("window.__geolocation.cleared")
    assert_equal "false", location_button["aria-pressed"]
    assert_no_selector "#map .maplibregl-user-location-dot", :visible => :all
    assert_no_selector "#map .maplibregl-user-location-accuracy-circle", :visible => :all
    assert_in_delta center[0], map_center[0], 0.0001
    assert_in_delta center[1], map_center[1], 0.0001

    events = page.evaluate_script("window.__geolocation.controlEvents.length")
    send_location(1, 4, 5)
    assert_equal events, page.evaluate_script("window.__geolocation.controlEvents.length")
    assert_in_delta center[0], map_center[0], 0.0001
    assert_in_delta center[1], map_center[1], 0.0001
  end

  test "resize preserves tracking and programmatic movement stops following" do
    original_size = page.current_window.size
    visit root_path(:anchor => "map=10/1/2")
    install_location_control

    location_button.click
    send_location(1)
    assert_selector "#{location_button_selector}.maplibregl-ctrl-geolocate-active"
    page.execute_script("window.__geolocation.resizes = 0; window.__map__.on('resize', () => window.__geolocation.resizes++)")
    page.current_window.resize_to(original_size[0] - 100, original_size[1] - 100)
    Selenium::WebDriver::Wait.new(:timeout => 10).until { page.evaluate_script("window.__geolocation.resizes > 0") }
    assert_selector "#{location_button_selector}.maplibregl-ctrl-geolocate-active"
    send_location(1, 1.1, 2.1)
    Selenium::WebDriver::Wait.new(:timeout => 10).until { (map_center[0] - 2.1).abs < 0.0001 }

    page.execute_script("window.__map__.stop().jumpTo({ center: [4, 3] })")
    assert_selector "#{location_button_selector}.maplibregl-ctrl-geolocate-background"

    send_location(1, 5, 6)
    assert_empty page.evaluate_script("window.__geolocation.cleared")
    assert_in_delta 4, map_center[0], 0.0001
    assert_in_delta 3, map_center[1], 0.0001
    assert_equal "true", location_button["aria-pressed"]
  ensure
    page.current_window.resize_to(*original_size) if original_size
  end

  test "location updates reach directions and removing the control clears its watch" do
    visit directions_path(:anchor => "map=10/1/2")
    assert_selector "#directions_route", :visible => :all
    install_location_control
    page.execute_script(<<~JS)
      const originalFetch = window.fetch;
      window.fetch = function (input, options) {
        const url = typeof input === "string" ? input : input.url;
        if (url.startsWith(OSM.NOMINATIM_URL + "reverse?")) {
          return Promise.resolve(new Response("{}", { status: 200 }));
        }
        return originalFetch.call(this, input, options);
      };
    JS

    location_button.click
    send_location(1)
    assert_equal "1, 2", find_by_id("route_from").value
    assert_equal %w[trackuserlocationstart geolocate],
                 page.evaluate_script("window.__geolocation.events.filter(type => type !== 'error').slice(0, 2)")

    page.execute_script("window.__map__.removeControl(window.__locationGroup)")
    assert_equal [1], page.evaluate_script("window.__geolocation.cleared")
    assert_no_selector "#map .maplibregl-user-location-dot", :visible => :all
    events = page.evaluate_script("window.__geolocation.controlEvents.length")
    send_location(1, 4, 5)
    page.execute_script("window.__geolocation.watches[0].error({ code: 2, message: 'late' })")
    assert_equal events, page.evaluate_script("window.__geolocation.controlEvents.length")
  end

  test "locate also works on the profile location map" do
    sign_in_as(create(:user))
    visit profile_location_path
    assert_selector "#map .maplibregl-canvas"
    page.execute_script(<<~JS)
      const zoomTo = OSM.MapLibre.Map.prototype.zoomTo;
      OSM.MapLibre.Map.prototype.zoomTo = function (...args) {
        window.__map__ = this;
        return zoomTo.apply(this, args);
      };
    JS
    find_button("Zoom Out").click
    install_location_control

    location_button.click
    send_location(1)
    assert_selector "#map .maplibregl-user-location-dot", :visible => :all
    location_button.click
    assert_equal [1], page.evaluate_script("window.__geolocation.cleared")
    assert_no_selector "#map .maplibregl-user-location-dot", :visible => :all
  end

  test "keyboard stop retains focus and permission denial disables the control" do
    visit root_path(:anchor => "map=10/1/2")
    install_location_control
    assert_equal "Show My Location", location_button["aria-label"]

    location_button.click
    send_location(1)
    page.execute_script("window.__geolocation.watches[0].error({ code: 2, message: 'unavailable' })")
    assert_selector "#{location_button_selector}.maplibregl-ctrl-geolocate-active-error"
    assert_selector "#map .maplibregl-user-location-dot-stale", :visible => :all
    location_button.send_keys(:space)
    assert_equal [1], page.evaluate_script("window.__geolocation.cleared")
    assert page.evaluate_script("document.activeElement === document.querySelector(arguments[0])", location_button_selector)

    location_button.click
    page.execute_script("window.__geolocation.watches[1].error({ code: 1, message: 'denied' })")
    assert_selector "#{location_button_selector}:disabled"
    assert_equal "Location not available", find("#{location_button_selector}:disabled")["aria-label"]
    assert_equal [1, 2], page.evaluate_script("window.__geolocation.cleared")
  end

  private

  def install_location_control
    assert_selector "#map .maplibregl-canvas"
    page.execute_script(<<~JS)
      const geo = window.__geolocation = { watches: [], cleared: [], events: [], controlEvents: [] };
      Object.defineProperty(navigator, "geolocation", {
        configurable: true,
        value: {
          watchPosition(success, error, options) {
            geo.watches.push({ success, error, options });
            return geo.watches.length;
          },
          clearWatch(id) { geo.cleared.push(id); },
          getCurrentPosition(success, error, options) {
            geo.watches.push({ success, error, options });
          }
        }
      });
      Object.defineProperty(navigator, "permissions", {
        configurable: true,
        value: { query: () => Promise.resolve({ state: "prompt" }) }
      });
      window.__locationControl = new OSM.MapLibre.GeolocateControl();
      window.__locationGroup = new OSM.MapLibre.CombinedControlGroup([window.__locationControl]);
      window.__map__.addControl(window.__locationGroup, "bottom-right");
      ["trackuserlocationstart", "geolocate", "trackuserlocationend", "userlocationlostfocus", "error"].forEach(type => {
        window.__map__.on(type, () => geo.events.push(type));
        window.__locationControl.on(type, () => geo.controlEvents.push(type));
      });
    JS
    assert_selector "#{location_button_selector}:not(:disabled)"
  end

  def location_button_selector
    "#map .maplibregl-ctrl-bottom-right .maplibregl-ctrl-geolocate"
  end

  def location_button
    find(location_button_selector)
  end

  def send_location(watch, lat = 1, lon = 2)
    page.execute_script(<<~JS, watch - 1, lat, lon)
      window.__geolocation.watches[arguments[0]].success({
        coords: { latitude: arguments[1], longitude: arguments[2], accuracy: 10 },
        timestamp: Date.now()
      });
    JS
  end

  def map_center
    page.evaluate_script("window.__map__.getCenter().toArray()")
  end
end
