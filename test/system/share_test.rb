# frozen_string_literal: true

require "application_system_test_case"
require "cgi"
require "uri"

class ShareTest < ApplicationSystemTestCase
  test "share links and image bounds follow the map, marker and filter" do
    visit root_path(:anchor => "map=12/10/20")
    find(".control-share .control-button").click
    assert_selector "#long_input"

    links = share_links
    assert_equal links["long"], links["long_input"]
    assert_equal links["short"], links["short_input"]
    assert_equal "/", URI(links["long"]).path
    assert_match %r{\A/go/}, URI(links["short"]).path
    assert_equal URI(page.current_url).host, URI(links["long"]).host
    assert_equal Settings.server_url.sub(/\Awww\.openstreetmap\.org/i, "osm.org"), URI(links["short"]).authority
    assert_equal Settings.server_protocol, URI(links["short"]).scheme
    assert_equal export_embed_path, URI(links["embed"]).path
    assert_empty CGI.parse(URI(links["long"]).query.to_s)
    assert_not CGI.parse(URI(links["short"]).query.to_s).key?("m")
    assert_not CGI.parse(URI(links["embed"]).query.to_s).key?("marker")
    assert_equal viewport_bbox, CGI.parse(URI(links["embed"]).query.to_s).fetch("bbox").first
    assert_equal "12", links["zoom"]
    assert_equal 1, links["zoom"].to_f - links["native_zoom"]

    check "link_marker"
    marked = share_links
    marker = CGI.parse(URI(marked["long"]).query.to_s)
    embed_marker = CGI.parse(URI(marked["embed"]).query.to_s).fetch("marker").first.split(",").map(&:to_f)
    assert marker.key?("mlat")
    assert marker.key?("mlon")
    assert_in_delta marker.fetch("mlat").first.to_f, embed_marker[0], 0.0001
    assert_in_delta marker.fetch("mlon").first.to_f, embed_marker[1], 0.0001
    assert CGI.parse(URI(marked["short"]).query.to_s).key?("m")
    assert_equal marked["long"], marked["long_input"]
    assert_equal marked["short"], marked["short_input"]
    assert_includes marked["html"], CGI.escapeHTML(marked["embed"])
    assert_includes marked["html"], CGI.escapeHTML(marked["long"])

    uncheck "link_marker"
    assert_not CGI.parse(URI(share_links["long"]).query.to_s).key?("mlat")
    check "image_filter"
    assert_selector ".location-filter.resize-marker", :count => 4
    before = image_bounds
    embed_before = CGI.parse(URI(share_links["embed"]).query.to_s).fetch("bbox").first

    handle = all(".location-filter.resize-marker").last
    page.driver.browser.action.move_to(handle.native).click_and_hold.move_by(35, -25).release.perform

    assert_not_equal before, image_bounds
    assert_equal embed_before, CGI.parse(URI(share_links["embed"]).query.to_s).fetch("bbox").first
    uncheck "image_filter"
    assert_equal viewport_bbox, image_bounds.join(",")
  end

  test "share pane survives close, reopen and navigation without stale map listeners" do
    visit root_path(:anchor => "map=12/10/20")
    assert_selector "#map .maplibregl-canvas"
    install_share_error_monitor

    find(".control-share .control-button").click
    assert_selector "#long_input"
    first_url = share_links["long"]
    find(".control-share .control-button").click
    assert_no_selector "#long_input", :visible => :visible
    page.execute_script("window.__map__.jumpTo({ center: [21, 11], zoom: 11 })")
    find(".control-share .control-button").click
    assert_selector "#long_input"
    assert_not_equal first_url, share_links["long"]
    assert_equal share_links["long"], share_links["long_input"]

    page.execute_script("OSM.router.route('/history#map=12/11/21')")
    assert_current_path history_path
    assert_selector "#sidebar_content .changesets"
    page.execute_script("window.__map__.jumpTo({ center: [22, 12], zoom: 11 })")
    assert_equal share_links["long"], share_links["long_input"]

    page.execute_script(<<~JS)
      const map = window.__map__;
      const control = map._controls.find(item => item.getContainer?.()?.querySelector(".control-share"));
      if (!control) throw new Error("Share control was not found");
      map.removeControl(control);
      document.querySelector(".share-ui").remove();
      map.jumpTo({ center: [23, 13], zoom: 11 });
    JS
    assert_no_share_errors
  end

  test "closing and navigating while the share pane loads leaves it usable" do
    visit root_path(:anchor => "map=12/10/20")
    assert_selector "#map .maplibregl-canvas"
    install_share_error_monitor

    pending = page.evaluate_script(<<~JS)
      (() => {
        const button = document.querySelector(".control-share .control-button");
        button.click();
        const pending = !document.querySelector("#long_input");
        button.click();
        OSM.router.route("/history#map=12/10/20");
        window.__map__.jumpTo({ center: [24, 14], zoom: 11 });
        return pending;
      })()
    JS
    assert pending, "Share pane unexpectedly finished loading synchronously"
    assert_current_path history_path
    assert_selector "#sidebar_content .changesets"
    assert_selector "#long_input", :visible => :all
    assert_no_selector "#long_input", :visible => :visible

    find(".control-share .control-button").click
    assert_selector "#long_input"
    page.execute_script("window.__map__.stop(); window.__map__.jumpTo({ center: [24, 14], zoom: 11 })")
    links = share_links
    assert_equal links["long"], links["long_input"]
    center = URI(links["long"]).fragment.split("/").last(2).map(&:to_f)
    assert_in_delta 14, center[0], 0.0001
    assert_in_delta 24, center[1], 0.0001
    assert_no_share_errors
  end

  private

  def install_share_error_monitor
    page.execute_script(<<~JS)
      window.shareLifecycleErrors = [];
      window.shareLifecycleConsole = [];
      window.addEventListener("error", event => window.shareLifecycleErrors.push(event.message));
      window.addEventListener("unhandledrejection", event => window.shareLifecycleErrors.push(String(event.reason)));
      const originalConsoleError = console.error;
      console.error = function (...args) {
        window.shareLifecycleConsole.push(args.map(String).join(" "));
        originalConsoleError.apply(this, args);
      };
    JS
  end

  def assert_no_share_errors
    page.evaluate_async_script("const done = arguments[0]; requestAnimationFrame(() => requestAnimationFrame(done));")
    assert_empty page.evaluate_script("window.shareLifecycleErrors")
    tile_errors, other_errors = page.evaluate_script("window.shareLifecycleConsole").partition do |error|
      error.match?(%r{\AError: AJAXError: NetworkError when attempting to fetch resource\. \(0\): https://tile\.openstreetmap\.org/\d+/\d+/\d+\.png\z})
    end
    warn "External tile requests failed: #{tile_errors.size}" if tile_errors.any?
    assert_empty other_errors
  end

  def share_links
    page.evaluate_script(<<~JS)
      (() => {
        const get = id => document.getElementById(id);
        const map = window.__map__;
        return {
          long: get("long_link").href, short: get("short_link").href, embed: get("embed_link").href,
          long_input: get("long_input").value, short_input: get("short_input").value,
          html: get("embed_html").value, zoom: String(map.getZoom()),
          native_zoom: maplibregl.Map.prototype.getZoom.call(map)
        };
      })()
    JS
  end

  def viewport_bbox
    page.evaluate_script(<<~JS)
      (() => {
        const bounds = window.__map__.getBounds();
        return [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].join(",");
      })()
    JS
  end

  def image_bounds
    page.evaluate_script(%w[minlon minlat maxlon maxlat].map { |name| "document.getElementById('mapnik_#{name}').value" }.join(", ").then { |fields| "[#{fields}]" })
  end
end
