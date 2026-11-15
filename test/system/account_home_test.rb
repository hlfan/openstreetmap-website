# frozen_string_literal: true

require "application_system_test_case"

class AccountHomeTest < ApplicationSystemTestCase
  test "Go to Home Location works on map layout pages" do
    user = create(:user, :display_name => "test user", :home_lat => 60, :home_lon => 30)
    sign_in_as(user)

    visit root_path(:anchor => "map=5/0/0")
    assert_no_selector ".maplibre-gl-marker"

    click_on "test user"
    click_on "Go to Home Location"
    all ".maplibre-gl-marker", :count => 1 do |marker|
      assert_equal "My home location", marker["title"]
    end
    assert_in_delta 60, page.evaluate_script("window.__map__.getCenter().lat"), 0.00001
    assert_in_delta 30, page.evaluate_script("window.__map__.getCenter().lng"), 0.00001
    assert_in_delta 15, page.evaluate_script("window.__map__.getZoom()"), 0.01

    click_on "OpenStreetMap logo"
    assert_no_selector ".maplibre-gl-marker"
  end

  test "Go to Home Location works on non-map layout pages" do
    user = create(:user, :display_name => "test user", :home_lat => 60, :home_lon => 30)
    sign_in_as(user)

    visit about_path
    assert_no_selector ".maplibre-gl-marker"

    click_on "test user"
    click_on "Go to Home Location"
    all ".maplibre-gl-marker", :count => 1 do |marker|
      assert_equal "My home location", marker["title"]
    end

    click_on "OpenStreetMap logo"
    assert_no_selector ".maplibre-gl-marker"
  end

  test "Go to Home Location is not available for users without home location" do
    user = create(:user, :display_name => "test user")
    sign_in_as(user)

    visit root_path
    assert_no_selector ".maplibre-gl-marker"

    click_on "test user"
    assert_no_link "Go to Home Location"
  end

  test "account home page shows a warning when visited by users without home location" do
    user = create(:user, :display_name => "test user")
    sign_in_as(user)

    visit account_home_path
    assert_no_selector ".maplibre-gl-marker"
    assert_text "Home location is not set"
  end

  test "account home page respects the URL hash on initialization" do
    user = create(:user, :display_name => "test user", :home_lat => 60, :home_lon => 30)
    sign_in_as(user)

    visit "#{account_home_path}#map=5/0/0"

    assert_selector "a.geolink[href*='#map=']"

    zoom = execute_script("return OSM.cookies.get('_osm_location').split('|')[2]")

    assert_equal "5", zoom
    assert_selector ".maplibre-gl-marker[title='My home location']", :visible => :all
    assert_in_delta 0, page.evaluate_script("window.__map__.getCenter().lat"), 0.00001
    assert_in_delta 0, page.evaluate_script("window.__map__.getCenter().lng"), 0.00001
    assert_in_delta 5, page.evaluate_script("window.__map__.getZoom()"), 0.01

    page.driver.browser.navigate.refresh
    assert_selector ".maplibre-gl-marker[title='My home location']", :visible => :all
    assert_in_delta 0, page.evaluate_script("window.__map__.getCenter().lat"), 0.00001
    assert_in_delta 0, page.evaluate_script("window.__map__.getCenter().lng"), 0.00001
    assert_in_delta 5, page.evaluate_script("window.__map__.getZoom()"), 0.01
  end

  test "account home page without a hash centers on the home location" do
    user = create(:user, :display_name => "test user", :home_lat => 60, :home_lon => 30)
    sign_in_as(user)

    visit account_home_path

    assert_selector ".maplibre-gl-marker[title='My home location']", :visible => :all
    assert_in_delta 60, page.evaluate_script("window.__map__.getCenter().lat"), 0.00001
    assert_in_delta 30, page.evaluate_script("window.__map__.getCenter().lng"), 0.00001
    assert_in_delta 15, page.evaluate_script("window.__map__.getZoom()"), 0.01
  end
end
