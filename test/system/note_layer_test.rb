# frozen_string_literal: true

require "application_system_test_case"

class NoteLayerTest < ApplicationSystemTestCase
  test "note layer uses the MapLibre event API" do
    visit root_path(:anchor => "map=18/1.1/1.1")

    assert page.evaluate_script("window.__map__.noteLayer instanceof maplibregl.Evented"),
           "Expected the notes layer to support MapLibre's add/remove lifecycle events"
  end

  test "notes and data overlays update the map URL when toggled" do
    visit root_path(:anchor => "map=18/1.1/1.1")
    page.evaluate_async_script("window.__map__.onceStyleReady(arguments[0])")
    assert page.evaluate_script("window.__map__.style._loaded")

    within "#map" do
      click_on "Layers"
    end
    within "#map-ui" do
      check "Map Notes"
      assert page.evaluate_script("window.__map__.hasLayer(window.__map__.noteLayer)")
      assert_equal "MN", page.evaluate_script("window.__map__.getLayersCode()")
      assert_current_path(/&layers=N$/, :url => true)

      page.execute_script("window.__originalIsStyleLoaded = window.__map__.isStyleLoaded; window.__map__.isStyleLoaded = () => false")
      begin
        check "Map Data"
      ensure
        page.execute_script("window.__map__.isStyleLoaded = window.__originalIsStyleLoaded; delete window.__originalIsStyleLoaded")
      end
      assert page.evaluate_script("window.__map__.hasLayer(window.__map__.noteLayer)")
      assert page.evaluate_script("window.__map__.hasLayer(window.__map__.dataLayer)")
      assert_equal "MND", page.evaluate_script("window.__map__.getLayersCode()")
      assert_current_path(/&layers=ND$/, :url => true)
    end

    assert_current_path(/&layers=ND$/, :url => true)
  end

  test "overlay controls reflect initial bounds and external layer changes" do
    visit root_path(:anchor => "map=3/0/0")
    within("#map") { click_on "Layers" }

    within "#map-ui" do
      assert_field "Map Notes", :checked => false, :disabled => true
      assert_field "Map Data", :checked => false, :disabled => true
      assert_field "Public GPS Traces", :checked => false, :disabled => false
      assert_selector ".form-check.disabled[data-name='notes']"
      find(".form-check[data-name='notes']").hover
    end
    assert_selector ".tooltip", :text => "Zoom in to see map notes"

    within "#map-ui" do
      page.execute_script("window.__map__.addLayer(window.__map__.noteLayer)")
      assert_field "Map Notes", :checked => true, :disabled => false
      assert_no_selector ".form-check.disabled[data-name='notes']"
      page.execute_script("window.__map__.removeLayer(window.__map__.noteLayer)")
      assert_field "Map Notes", :checked => false, :disabled => true

      page.execute_script("window.__map__.addLayer(window.__map__.dataLayer)")
      assert_field "Map Data", :checked => true, :disabled => false
      page.execute_script("window.__map__.removeLayer(window.__map__.dataLayer)")
      assert_field "Map Data", :checked => false, :disabled => true
    end
  end

  test "an over-limit overlay from the URL starts enabled" do
    visit root_path(:anchor => "map=3/0/0&layers=N")
    within("#map") { click_on "Layers" }
    within "#map-ui" do
      assert_field "Map Notes", :checked => true, :disabled => false
      assert_field "Map Data", :checked => false, :disabled => true
    end
  end

  test "checked overlays can be turned off after zooming out" do
    visit root_path(:anchor => "map=18/1.1/1.1")
    page.evaluate_async_script("window.__map__.onceStyleReady(arguments[0])")
    within("#map") { click_on "Layers" }

    within "#map-ui" do
      check "Map Notes"
      check "Map Data"
      page.execute_script("window.__map__.jumpTo({ center: [0, 0], zoom: 3 })")
      assert_field "Map Notes", :checked => true, :disabled => false
      assert_field "Map Data", :checked => true, :disabled => false
      assert page.evaluate_script("window.__map__.hasLayer(window.__map__.noteLayer)")
      assert page.evaluate_script("window.__map__.hasLayer(window.__map__.dataLayer)")

      uncheck "Map Notes"
      uncheck "Map Data"
      assert_field "Map Notes", :checked => false, :disabled => true
      assert_field "Map Data", :checked => false, :disabled => true
      assert_not page.evaluate_script("window.__map__.hasLayer(window.__map__.noteLayer)")
      assert_not page.evaluate_script("window.__map__.hasLayer(window.__map__.dataLayer)")

      page.execute_script("window.__map__.jumpTo({ center: [1.1, 1.1], zoom: 17 })")
      assert_field "Map Notes", :checked => false, :disabled => false
      assert_field "Map Data", :checked => false, :disabled => false
      assert_not page.evaluate_script("window.__map__.hasLayer(window.__map__.noteLayer)")
      assert_not page.evaluate_script("window.__map__.hasLayer(window.__map__.dataLayer)")
    end
  end

  test "note marker should have description as a title" do
    position = (1.1 * GeoRecord::SCALE).to_i
    create(:note, :latitude => position, :longitude => position) do |note|
      create(:note_comment, :note => note, :body => "Note description", :event => "opened")
    end

    visit root_path(:anchor => "map=18/1.1/1.1&layers=N")
    all ".maplibre-gl-marker", :count => 1 do |marker|
      assert_equal "Note description", marker["title"]
    end
    assert_selector "#map .maplibre-gl-marker use[href='#pin-exclam']", :visible => :all
    assert_selector "svg defs #pin-exclam", :visible => :all
  end

  test "note marker should not have a title if the note has no visible description" do
    position = (1.1 * GeoRecord::SCALE).to_i
    create(:note, :latitude => position, :longitude => position) do |note|
      create(:note_comment, :note => note, :body => "Note description is hidden", :event => "opened", :visible => false)
      create(:note_comment, :note => note, :body => "Note comment visible")
    end

    visit root_path(:anchor => "map=18/1.1/1.1&layers=N")
    all ".maplibre-gl-marker", :count => 1 do |marker|
      assert_equal "", marker["title"]
    end
  end

  test "note marker should not have a title if the note has no visible description and comments" do
    position = (1.1 * GeoRecord::SCALE).to_i
    create(:note, :latitude => position, :longitude => position) do |note|
      create(:note_comment, :note => note, :body => "Note description is hidden", :event => "opened", :visible => false)
    end

    visit root_path(:anchor => "map=18/1.1/1.1&layers=N")
    all ".maplibre-gl-marker", :count => 1 do |marker|
      assert_equal "", marker["title"]
    end
  end
end
