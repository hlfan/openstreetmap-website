# frozen_string_literal: true

require "application_system_test_case"

class ProfileLocationChangeTest < ApplicationSystemTestCase
  test "can't change location when unauthorized" do
    user = create(:user)

    visit user_path(user)

    within_content_heading do
      assert_no_button "Edit Profile Details"
      assert_no_link "Edit Location"
    end
  end

  test "can't change location of another user" do
    user = create(:user)
    another_user = create(:user)

    sign_in_as(user)
    visit user_path(another_user)

    within_content_heading do
      assert_no_button "Edit Profile Details"
      assert_no_link "Edit Location"
    end
  end

  test "can change location" do
    user = create(:user)

    sign_in_as(user)
    visit user_path(user)

    within_content_body do
      click_on "Edit Profile Details"
      click_on "Edit Location"
      fill_in "Home Location Name", :with => "Test Place"
      click_on "Update Profile"
    end

    assert_text "Profile location updated."

    within_content_body do
      assert_text :all, "Home location Test Place"

      click_on "Edit Profile Details"
      click_on "Edit Location"
      fill_in "Home Location Name", :with => "New Test Place"
      click_on "Update Profile"
    end

    assert_text "Profile location updated."

    within_content_body do
      assert_text :all, "Home location New Test Place"
    end
  end

  test "location name is set from the home location" do
    stub_nominatim_reverse(:body => "<reversegeocode><result>Test Country</result></reversegeocode>")
    user = create(:user)

    sign_in_as(user)
    visit profile_location_path

    within_content_body do
      fill_in "Latitude", :with => "1"
      fill_in "Longitude", :with => "2"
      assert_field "Home Location Name", :with => "Test Country"

      stub_nominatim_reverse(:body => "<reversegeocode><error>Unable to geocode</error></reversegeocode>")
      fill_in "Longitude", :with => "4"
      assert_field "Home Location Name", :with => ""
    end
  end

  test "reverse geocoding failure preserves the home location name" do
    stub_nominatim_reverse(:body => "<reversegeocode><result>Test Country</result></reversegeocode>")
    user = create(:user)

    sign_in_as(user)
    visit profile_location_path
    fill_in "Latitude", :with => "1"
    fill_in "Longitude", :with => "2"
    assert_field "Home Location Name", :with => "Test Country"

    page.execute_script(<<~JS)
      const fetch = window.fetch;
      window.fetch = (...args) => fetch(...args).then(async response => {
        if (args[0] !== "/search/nominatim_reverse_query") return response;
        const data = await response.json();
        setTimeout(() => {
          document.querySelector("#home_location_name").dataset.reverseGeocodeStatus = response.status;
        }, 0);
        return { ok: response.ok, statusText: response.statusText, json: () => Promise.resolve(data) };
      });
    JS
    stub_nominatim_reverse(:status => 400, :body => "Bad Request")
    fill_in "Longitude", :with => "3"
    assert_selector "#home_location_name[data-reverse-geocode-status='502']"
    assert_field "Home Location Name", :with => "Test Country"

    stub_nominatim_reverse(:body => "<reversegeocode><result>Other Country</result></reversegeocode>")
    fill_in "Longitude", :with => "4"
    assert_field "Home Location Name", :with => "Other Country"
  end

  test "can select and restore a home location on the map" do
    user = create(:user, :home_lat => 51, :home_lon => 1)
    stub_request(:get, %r{^https://nominatim\.openstreetmap\.org/reverse\?})
      .to_return(:body => '<reversegeocode><result lat="51" lon="1">Test Place</result></reversegeocode>')

    sign_in_as(user)
    visit profile_location_path

    assert_selector "#map .maplibregl-marker"
    original_lat = find_field("home_lat").value
    check "updatehome"
    find("#map canvas").click(:x => 50, :y => 50)
    assert_no_field "home_lat", :with => original_lat
    assert_selector "#map .maplibregl-marker"

    selected_lat = find_field("home_lat").value
    selected_lon = find_field("home_lon").value
    click_on "Delete"
    assert_no_selector "#map .maplibregl-marker"
    click_on "Undo delete"
    assert_field "home_lat", :with => selected_lat
    assert_field "home_lon", :with => selected_lon
    assert_selector "#map .maplibregl-marker"
    click_on "Update Profile"

    assert_text "Profile location updated."
    assert_in_delta selected_lat.to_f, user.reload.home_lat, 0.00001
    assert_in_delta selected_lon.to_f, user.home_lon, 0.00001
  end

  test "showing a home location restores the default map zoom" do
    user = create(:user, :home_lat => 51, :home_lon => 1)

    sign_in_as(user)
    visit profile_location_path
    assert_selector "#map .maplibregl-canvas"

    page.execute_script(<<~JS)
      const zoomTo = OSM.MapLibre.Map.prototype.zoomTo;
      OSM.MapLibre.Map.prototype.zoomTo = function (...args) {
        window.profileMapForTest = this;
        return zoomTo.apply(this, args);
      };
    JS
    find_button("Zoom Out").click
    page.execute_script("window.profileMapForTest.stop().jumpTo({ center: [2, 52], zoom: 5 })")
    assert_selector "#home_show:not(:disabled)"
    page.execute_script(<<~JS)
      const map = window.profileMapForTest;
      const flyTo = map.flyTo;
      map.flyTo = function (options, ...args) {
        window.profileRequestedZoom = options.zoom;
        return flyTo.call(this, options, ...args);
      };
      map.once("moveend", () => map.getContainer().dataset.homeArrival = "true");
    JS
    find_by_id("home_show").click
    assert_equal 11, page.evaluate_script("window.profileRequestedZoom")
    assert_selector "#map[data-home-arrival='true']", :wait => 15
    result = page.evaluate_script(<<~JS)
      (() => {
        const map = window.profileMapForTest;
        const center = map.getCenter();
        return { lat: center.lat, lon: center.lng, native: maplibregl.Map.prototype.getZoom.call(map), osm: map.getZoom() };
      })()
    JS

    assert_in_delta 51, result["lat"], 0.00001
    assert_in_delta 1, result["lon"], 0.00001
    assert_in_delta 11, result["native"], 0.00001
    assert_in_delta 12, result["osm"], 0.00001
  end

  private

  def stub_nominatim_reverse(response)
    stub_request(:get, %r{^https://nominatim\.openstreetmap\.org/reverse\?}).to_return(response)
  end
end
