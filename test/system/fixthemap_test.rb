require "application_system_test_case"

class FixthemapTest < ApplicationSystemTestCase
  test "should have 'create a note' link with correct map hash" do
    visit fixthemap_path(:lat => 60, :lon => 30, :zoom => 10)

    within_content_body do
      assert_link "Add a note to the map", :href => "/note/new#map=10/60.0000/30.0000"
    end
  end
end
